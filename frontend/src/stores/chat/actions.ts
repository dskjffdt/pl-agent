import { v7 as uuid7 } from 'uuid'
import type { ChatNode } from '../../api/type'
import { runStream, runtimes, seal, type StreamOptions } from './runtime'
import { selectEntry, useChatStreams } from './store'
import type { RetryOptions, SendOptions, StreamEntry } from './types'

// ---- 对外 actions ----

// 本地节点临时 id 前缀：meta 到达前占位，随后对齐后端真 id
const localId = (prefix: string) => `local-${prefix}-${crypto.randomUUID()}`

// 正常发送：新会话（建 entry）或会话内新一轮（挂链尾），均伴随新建 user 节点
export function sendMessage(opts: SendOptions) {
    // 会话 id 由前端生成（UUIDv7，时间前缀天然有序）：新会话先定 id 再发请求，URL/store 立即对齐，不等后端 meta
    const chatId = opts.routeId ?? uuid7()
    let entry = selectEntry(useChatStreams.getState(), chatId)
    if (!entry) {
        entry = { chatId, nodes: new Map(), activeLeafId: null, streaming: false, hasMore: false, oldestNodeId: null }
        useChatStreams.setState((prev) => ({ entries: [...prev.entries, entry!] }))
        // 同步回调导航（entry 已在 store，导航后 hasEntry 命中不重拉）；侧栏等 meta 确认后再插
        opts.onConversationId?.(chatId)
    }

    const userId = localId('u')
    const userNode: ChatNode = {
        // 挂当前链尾（新会话为 null）；user 节点立即可见，等后端 id 对齐后重挂键
        id: userId,
        parentId: entry.activeLeafId,
        // user 消息无流式态，恒为 done
        record: { id: userId, prompt: opts.prompt, reasoning: '', content: '', status: 'done' },
    }
    spawnStream(entry, {
        prompt: opts.prompt,
        branchParentId: entry.activeLeafId,
        userNode,
        onServerConfirmed: opts.onServerConfirmed,
        onDone: opts.onDone,
    })
}

// 重试：不建 user 节点，新 assistant 直接挂到被重试的 user 节点下作为兄弟版本
export function retryMessage(opts: RetryOptions) {
    const entry = selectEntry(useChatStreams.getState(), opts.chatId)
    if (!entry) return
    // 版本上限：同一 user 节点下已有 3 个回复版本则拒绝（UI 已禁用，此处兜底防绕过）
    const versions = [...entry.nodes.values()].filter((n) => n.parentId === opts.retryParentId).length
    if (versions >= 3) return

    spawnStream(entry, {
        prompt: opts.prompt,
        branchParentId: opts.retryParentId,
        retryParentId: opts.retryParentId,
        onDone: opts.onDone,
    })
}

// 公共发流：建 assistant 工作节点并入快照，随后启动 SSE（userNode 仅正常发送时存在）
function spawnStream(
    entry: StreamEntry,
    params: {
        prompt: string
        // 请求上下文父节点：正常=链尾 assistant，重试=被重试 user 节点
        branchParentId: string | null
        userNode?: ChatNode
        // 非空即重试请求（传给后端走 fork 语义）
        retryParentId?: string
        onServerConfirmed?: (id: string) => void
        onDone?: () => void
    },
) {
    const liveId = localId('a')
    const live: ChatNode = {
        id: liveId,
        parentId: params.userNode ? params.userNode.id : params.branchParentId,
        // 初始 pending：已发送但还没出任何字；首个 token/工具事件到达后转 streaming
        record: { id: liveId, prompt: params.prompt, reasoning: '', content: '', status: 'pending' },
    }

    // 新节点并入不可变快照（user 立即可见，等后端 id 对齐后重挂键）
    const nodes = new Map(entry.nodes)
    if (params.userNode) nodes.set(params.userNode.id, params.userNode)
    nodes.set(live.id, live)
    useChatStreams.setState((prev) => ({
        entries: prev.entries.map((e) => (e.chatId === entry.chatId ? { ...e, nodes } : e)),
    }))

    const rt = {
        chatId: entry.chatId,
        confirmed: false,
        controller: new AbortController(),
        // 独立副本：运行时对齐/迁移节点键不污染已发布快照
        history: new Map(nodes),
        live,
        rafId: null,
    }
    runtimes.set(entry.chatId, rt)
    const streamOpts: StreamOptions = {
        prompt: params.prompt,
        retryParentId: params.retryParentId,
        onServerConfirmed: params.onServerConfirmed,
        onDone: params.onDone,
    }
    void runStream(rt, streamOpts, params.branchParentId)
}

// 停止生成：中断请求 + 收尾已生成内容（已生成部分不丢，状态标记为 aborted）
export function stopStream(chatId: string) {
    const rt = runtimes.get(chatId)
    if (!rt) return
    rt.controller.abort()
    seal(rt, 'aborted')
}

// 会话详情落库（切换会话时从服务端拉取的树节点；末节点即时间序链尾）
export function hydrateEntry(chatId: string, nodes: ChatNode[], hasMore = false) {
    const map = new Map(nodes.map((n) => [n.id, n]))
    const leaf = nodes.length ? nodes[nodes.length - 1].id : null
    const oldestNodeId = nodes.length ? nodes[0].id : null
    useChatStreams.setState((prev) => ({
        entries: [...prev.entries, { chatId, nodes: map, activeLeafId: leaf, streaming: false, hasMore, oldestNodeId }],
    }))
}

// 向上加载更多：把更早的节点前置合并到已有 entry（不覆盖，只补充）
export function prependNodes(chatId: string, nodes: ChatNode[], hasMore: boolean) {
    useChatStreams.setState((prev) => ({
        entries: prev.entries.map((e) => {
            if (e.chatId !== chatId) return e
            const merged = new Map(e.nodes)
            // 新拉取的节点在时间上更早，放前面
            for (const n of nodes) merged.set(n.id, n)
            return {
                ...e,
                nodes: merged,
                hasMore,
                oldestNodeId: nodes.length ? nodes[0].id : e.oldestNodeId,
            }
        }),
    }))
}

// 本地已存在该会话的 entry
export function hasEntry(chatId: string): boolean {
    return selectEntry(useChatStreams.getState(), chatId) !== undefined
}

// 分支切换：激活某节点及其后代链尾（无子节点则自己），路径随之重算重渲
export function switchBranch(chatId: string | null, nodeId: string) {
    const entry = selectEntry(useChatStreams.getState(), chatId)
    if (!entry || !entry.nodes.has(nodeId)) return
    let leaf = nodeId
    while (true) {
        const child = [...entry.nodes.values()].find((n) => n.parentId === leaf)
        if (!child) break
        leaf = child.id
    }
    useChatStreams.setState((prev) => ({
        entries: prev.entries.map((e) => (e.chatId === entry!.chatId ? { ...e, activeLeafId: leaf } : e)),
    }))
}

// 删除会话：中断该会话可能进行中的流并移除 entry（后台删除同样适用）
export function discardEntry(chatId: string) {
    const rt = runtimes.get(chatId)
    if (rt) rt.controller.abort()
    runtimes.delete(chatId)
    useChatStreams.setState((prev) => ({ entries: prev.entries.filter((e) => e.chatId !== chatId) }))
}

// 登出/登录过期：中断全部流并清空所有会话内容
export function discardAll() {
    for (const rt of runtimes.values()) {
        rt.controller.abort()
    }
    runtimes.clear()
    useChatStreams.setState({ entries: [] })
}
