import { useCallback, useState } from 'react'
import { AuthError } from '../api/auth'
import { listConversations } from '../api/chat'
import type { SessionMeta } from '../api/type'

// 侧栏会话列表：拉取、新增（乐观插入）、移除、清空
// 全部回调 useCallback 固定引用，配合 Sidebar 的 memo，流式重渲期间侧栏零渲染
export function useSessions() {
    const [sessions, setSessions] = useState<SessionMeta[]>([])

    // 拉取会话列表。与现有数据逐字段对比，无变化则沿用旧数组引用，
    // React 凭 Object.is 相等跳过重渲，避免幂等请求（挂载/登录后）触发整表刷新
    const loadSessions = useCallback(async () => {
        try {
            const next = await listConversations()
            setSessions((prev) =>
                prev.length === next.length &&
                prev.every((s, i) => s.id === next[i].id && s.title === next[i].title && s.updated_at === next[i].updated_at)
                    ? prev
                    : next,
            )
        } catch (e) {
            if (!(e instanceof AuthError)) console.error(e)
        }
    }, [])

    // 新会话落库：插到列表头（乐观更新，title 为首条消息前 20 字）
    const prependSession = useCallback((id: string, title: string) => {
        setSessions((prev) =>
            prev.some((s) => s.id === id) ? prev : [{ id, title, updated_at: new Date().toISOString() }, ...prev],
        )
    }, [])

    // 删除成功后移出侧栏
    const removeSession = useCallback((id: string) => {
        setSessions((prev) => prev.filter((s) => s.id !== id))
    }, [])

    // 登出：清空列表
    const clearSessions = useCallback(() => {
        setSessions([])
    }, [])

    return { sessions, loadSessions, prependSession, removeSession, clearSessions }
}
