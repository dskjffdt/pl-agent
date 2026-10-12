import { useCallback, useEffect, useRef, useState } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import { AuthError } from '../api/auth'
import { getConversation, streamChat } from '../api/chat'
import type { ChatRecord } from '../api/type'
import { useTypewriter } from './useTypewriter'
import { mapConversationDetail, updateLastRecord } from '../utils/records'

type ChatSessionParams = {
    // URL 路由出的当前会话 id（null = 新会话）
    routeId: string | null
    // 登录态变化触发会话内容加载（登录后直达已有会话的恢复入口）
    authed: boolean
    navigate: NavigateFunction
    // 新会话落库后插入侧栏列表头
    onConversationCreated: (id: string, title: string) => void
}

// 会话内容与流式对话：records 状态、打字机接线、URL→会话内容同步、发送/停止
export function useChatSession({ routeId, authed, navigate, onConversationCreated }: ChatSessionParams) {
    // 当前会话的对话记录
    const [records, setRecords] = useState<ChatRecord[]>([])
    const [sending, setSending] = useState(false)
    // 打字机引擎：SSE 文本经它逐字揭示成块；paused/togglePause 控制暂停与继续
    const { reset, enqueue, finish, stop, paused, togglePause } = useTypewriter(setRecords, () => setSending(false))
    // 停止生成：中断当前流式请求
    const abortRef = useRef<AbortController | null>(null)
    // 会话 id 在流式请求中途才下发，sendPrompt 闭包里读不到最新值，用 ref 兜底
    const activeIdRef = useRef<string | null>(null)
    // 已加载进 records 的会话 id：新会话落库后 URL replace 回来时不重复拉取
    const loadedIdRef = useRef<string | null>(null)

    // 拉取会话消息并还原成对话记录（user/assistant 配对逻辑收敛在 utils/records 纯函数）
    async function loadConversation(id: string) {
        try {
            setRecords(mapConversationDetail(await getConversation(id)))
        } catch (e) {
            if (e instanceof AuthError) return
            // 会话不存在（过期/伪造的链接）：静默回新会话
            if (e instanceof Error && e.message.includes('404')) {
                navigate('/chat/new', { replace: true })
            } else {
                console.error(e)
            }
        }
    }

    // URL 变化 → 同步会话内容（切换/直达/新建统一入口）
    useEffect(() => {
        activeIdRef.current = routeId
        // 新会话首条消息落库后的 URL replace：流式进行中，不重载
        if (routeId === loadedIdRef.current) return
        loadedIdRef.current = routeId
        if (routeId === null) {
            setRecords([])
            return
        }
        // 切换会话：中止进行中的生成（已生成部分保留）
        abortRef.current?.abort()
        stop()
        void loadConversation(routeId)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [routeId, authed])

    // 登出/登录过期：清空会话内容（URL 与登录态由调用方接管）
    function resetContent() {
        loadedIdRef.current = null
        setRecords([])
    }

    // 删除目标是否为当前会话（决定删除后路由是否回新会话）；useCallback 固定引用供 App 的 handler 依赖
    const isActive = useCallback(
        (id: string) => id === activeIdRef.current,
        [],
    )

    async function sendPrompt(text: string) {
        setSending(true)
        // 先追加一条流式中的记录
        setRecords((prev) => [
            ...prev,
            { id: `local-${Date.now()}`, prompt: text, reasoning: [], content: [], streaming: true },
        ])
        reset()

        const controller = new AbortController()
        abortRef.current = controller
        try {
            await streamChat(text, activeIdRef.current, controller.signal, {
                onConversationId: (id) => {
                    // URL replace 到真实会话 id（后退不回 /chat/new），loadedId 同步防止重载
                    activeIdRef.current = id
                    loadedIdRef.current = id
                    onConversationCreated(id, text.slice(0, 20))
                    navigate(`/chat/${id}`, { replace: true })
                },
                onText: enqueue,
                onToolStart: (id, name) =>
                    updateLastRecord(setRecords, (last) => {
                        last.toolEvents = [...(last.toolEvents ?? []), { id, name, status: 'running' }]
                    }),
                onToolEnd: (id, status) =>
                    updateLastRecord(setRecords, (last) => {
                        last.toolEvents = (last.toolEvents ?? []).map((t) => (t.id === id ? { ...t, status } : t))
                    }),
                onFiltered: () =>
                    updateLastRecord(setRecords, (last) => {
                        last.filtered = true
                    }),
            })
        } catch (e) {
            // 主动停止不提示错误；登录过期由登录弹窗接管，也不提示
            if (e instanceof AuthError) return
            if (!(e instanceof DOMException && e.name === 'AbortError')) {
                updateLastRecord(setRecords, (last) => {
                    last.error = '生成失败，请检查网络或后端服务后重试'
                })
            }
        } finally {
            // 流结束：RAF 会在处理完缓冲后自动标记 streaming: false 并回调关闭 sending
            finish()
        }
    }

    // 停止生成：中断请求 + 打字机收尾保留已生成内容
    function stopGeneration() {
        abortRef.current?.abort()
        stop()
    }

    return { records, sending, paused, togglePause, sendPrompt, stopGeneration, resetContent, isActive }
}
