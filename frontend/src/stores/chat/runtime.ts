import { AuthError } from '../../api/auth'
import { streamChat } from '../../api/chat'
import type { ChatNode } from '../../api/type'
import { buildNetworkError } from '../../utils/apiError'
import { useChatStreams } from './store'
import type { Runtime, StreamEntry } from './types'

// 一次流式请求的参数：retryParentId 非空即重试请求（后端据此走 fork 语义）
export type StreamOptions = {
    prompt: string
    retryParentId?: string | null
    // 服务端确认会话落库（meta 到达）后的通知；防重入由 Runtime.confirmed 保证
    onServerConfirmed?: (id: string) => void
    // 流结束（成功/中止/报错）后的通知；登录过期不触发（会话列表由登出逻辑清空）
    onDone?: () => void
}

// 运行时容器：模块级 Map 按 chatId 键，不进 store；flush 时才投影为不可变 entry
export const runtimes = new Map<string, Runtime>()

// ---- 内部机制 ----

// 可变 runtime → 不可变 entry 快照（历史节点浅拷贝 + live 整体替换）
function project(rt: Runtime): StreamEntry {
    const nodes = new Map(rt.history)
    nodes.set(rt.live.id, { ...rt.live, record: { ...rt.live.record } })
    // 分页字段从现有 entry 继承（流式期间不变）
    const prevEntry = useChatStreams.getState().entries.find((e) => e.chatId === rt.chatId)
    return {
        chatId: rt.chatId,
        nodes,
        activeLeafId: rt.live.id,
        streaming: rt.live.record.status === 'pending' || rt.live.record.status === 'streaming',
        hasMore: prevEntry?.hasMore ?? false,
        oldestNodeId: prevEntry?.oldestNodeId ?? null,
    }
}

export function flush(rt: Runtime) {
    useChatStreams.setState((prev) => ({
        entries: prev.entries.map((e) => (e.chatId === rt.chatId ? project(rt) : e)),
    }))
}

// 帧合批：token/工具事件高频写入 runtime，同帧内只投影一次到 store。
// 写入是同步的（数据不丢），只是把多次 setState 合并到下一帧执行，降低渲染压力。
// 调度句柄收敛在 rt.rafId，同一帧重复调用不重复排队。
function scheduleFlush(rt: Runtime) {
    if (rt.rafId !== null) return
    rt.rafId = requestAnimationFrame(() => {
        rt.rafId = null
        flush(rt)
    })
}

// 收尾：结束流式态。status 区分中断原因：
// - aborted：用户主动停止 / 登录过期被踢（保留已生成内容，不显示错误）
// - error：请求失败（显示 error 文案）
// 必须先取消未执行的 rAF，再同步 flush——否则停止后最后半截内容可能要等下一帧才显示，
// 极端情况下（rAF 已被 cancel）甚至丢渲染。
export function seal(rt: Runtime, status: 'aborted' | 'error', error?: string) {
    if (rt.rafId !== null) {
        cancelAnimationFrame(rt.rafId)
        rt.rafId = null
    }
    rt.live.record.status = status
    if (error) rt.live.record.error = error
    flush(rt)
    runtimes.delete(rt.chatId)
}

// ---- 流式请求执行 ----

export async function runStream(rt: Runtime, opts: StreamOptions, parentId: string | null) {
    try {
        await streamChat(
            opts.prompt,
            {
                conversationId: rt.chatId,
                parentId,
                retry: opts.retryParentId != null,
            },
            rt.controller.signal,
            {
                onMeta: (meta) => {
                    // 服务端确认会话落库：通知侧栏插入（防重入：resume 重放 meta 不重复触发）
                    if (meta.conversationId && !rt.confirmed) {
                        rt.confirmed = true
                        opts.onServerConfirmed?.(meta.conversationId)
                    }
                    // user 节点对齐后端真 id（新轮才下发；本地占位键需迁移）
                    if (meta.userId) {
                        const placeholder = rt.history.get(rt.live.parentId ?? '')
                        if (placeholder) {
                            rt.history.delete(placeholder.id)
                            const serverUser: ChatNode = {
                                ...placeholder,
                                id: meta.userId,
                                record: { ...placeholder.record, id: meta.userId },
                            }
                            rt.history.set(serverUser.id, serverUser)
                            rt.live = { ...rt.live, parentId: serverUser.id }
                        }
                    }
                    // assistant 节点对齐后端真 id（占位键随之迁移，不留幽灵节点）
                    if (meta.assistantId && rt.live.id !== meta.assistantId) {
                        rt.history.delete(rt.live.id)
                        rt.live = { ...rt.live, id: meta.assistantId, record: { ...rt.live.record, id: meta.assistantId } }
                    }
                    scheduleFlush(rt)
                },
                onText: (reasoning, content) => {
                    if (!reasoning && !content) return
                    // 首个输出到达：pending → streaming（仅转换一次）
                    if (rt.live.record.status === 'pending') rt.live.record.status = 'streaming'
                    if (reasoning) rt.live.record.reasoning += reasoning
                    if (content) rt.live.record.content += content
                    scheduleFlush(rt)
                },
                onToolStart: (id, name) => {
                    if (rt.live.record.status === 'pending') rt.live.record.status = 'streaming'
                    rt.live.record.toolEvents = [...(rt.live.record.toolEvents ?? []), { id, name, status: 'running' }]
                    scheduleFlush(rt)
                },
                onToolEnd: (id, status) => {
                    rt.live.record.toolEvents = (rt.live.record.toolEvents ?? []).map((t) => (t.id === id ? { ...t, status } : t))
                    scheduleFlush(rt)
                },
            },
        )
        // SSE 正常结束：cancel 未执行的 rAF 后同步 flush，确保最终态即时落库展示
        rt.live.record.status = 'done'
        if (rt.rafId !== null) {
            cancelAnimationFrame(rt.rafId)
            rt.rafId = null
        }
        flush(rt)
        runtimes.delete(rt.chatId)
        opts.onDone?.()
    } catch (e) {
        // 登录过期：静默收尾已生成内容（登录弹窗由 401 广播接管）；不刷新侧栏
        if (e instanceof AuthError) {
            seal(rt, 'aborted')
            return
        }
        // 用户主动停止：seal 已由 stopStream 同步完成
        if (e instanceof DOMException && e.name === 'AbortError') {
            opts.onDone?.()
            return
        }
        seal(rt, 'error', buildNetworkError(e).message)
        opts.onDone?.()
    }
}
