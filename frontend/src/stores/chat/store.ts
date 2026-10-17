import { create } from 'zustand'
import type { ChatNode } from '../../api/type'
import type { ChatStreamsState, PathItem, StreamEntry } from './types'

const useChatStreams = create<ChatStreamsState>(() => ({ entries: [] }))

// ---- 查询 selector（视图按 chatId 订阅，后台流的 flush 不触发本会话重渲） ----

function selectEntry(state: ChatStreamsState, chatId: string | null): StreamEntry | undefined {
    return state.entries.find((e) => e.chatId === chatId)
}

const EMPTY_PATH: PathItem[] = []

/**
 * 活跃分支渲染路径（节点 + 同父兄弟）纯投影：入参 entry 在自身未被 flush 替换时引用稳定。
 * 注意：不能直接把本函数塞进 zustand selector——每次返回新数组会被 useSyncExternalStore
 * 判定为 snapshot 变化导致无限重渲（React #185）；消费侧应先选 entry 再在渲染体投影
 * （投影结果由 React Compiler 按 entry 引用自动缓存）。
 */
export function buildPath(entry: StreamEntry | undefined): PathItem[] {
    if (!entry || !entry.activeLeafId) return EMPTY_PATH
    // 父指针树从根向下无法定向（版本分叉处不知选哪个），故从末端锚点上溯定路，反转后即根 → 叶渲染序
    const chain: ChatNode[] = []
    let cur: ChatNode | undefined = entry.nodes.get(entry.activeLeafId)
    while (cur) {
        chain.push(cur)
        cur = cur.parentId ? entry.nodes.get(cur.parentId) : undefined
    }
    chain.reverse()
    // 每条投影直接子节点（user 节点下即多个回复版本，供分页器切换）；节点量小，逐个过滤即可
    return chain.map((node) => ({
        node,
        childIds: [...entry.nodes.values()]
            .filter((n) => n.parentId === node.id)
            .map((n) => n.id),
    }))
}

export { selectEntry, useChatStreams }
