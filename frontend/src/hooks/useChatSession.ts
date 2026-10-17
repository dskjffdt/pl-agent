import { useLayoutEffect, useRef } from 'react'
import type { NavigateFunction } from 'react-router-dom'
import { AuthError } from '../api/auth'
import { getConversation } from '../api/chat'
import { ApiError, buildNetworkError } from '../utils/apiError'
import { useToast } from '../stores/useToast'
import {
    hasEntry,
    hydrateEntry,
    prependNodes,
    retryMessage,
    sendMessage,
    useChatStreams,
    selectEntry,
} from '../stores/chat'
import { mapConversationDetail } from '../utils/records'

// 每次分页加载的消息条数
const PAGE_SIZE = 5

type ChatSessionParams = {
    // URL 路由出的当前会话 id（null = 新会话）
    routeId: string | null
    // 登录态变化触发会话内容加载（登录后直达已有会话的恢复入口）
    authed: boolean
    navigate: NavigateFunction
    // 服务端确认会话落库后插入侧栏列表头（id 前端生成，落库以 meta 为准）
    onConversationCreated: (id: string, title: string) => void
    // 每条流结束（成功/中止/报错）后刷新侧栏（标题自动生成/排序变化靠它回显）
    onStreamEnded: () => void
}

// 会话编排：URL→会话内容同步 + 发送/停止/重试入口。
// 流式与对话内容都住在 useChatStreams store（按会话隔离，支持并行流），
// 切换会话不中断后台流，本 hook 不持有任何 records 状态。
export function useChatSession({ routeId, authed, navigate, onConversationCreated, onStreamEnded }: ChatSessionParams) {
    // origin 记录发送/重试时所在会话（新会话为 null），回调里判定导航与侧栏插入
    const routeIdRef = useRef<string | null>(null)
    const addToast = useToast((s) => s.addMessage)

    // URL 变化 → 同步会话内容（切换/直达/新建统一入口）
    // useLayoutEffect：在浏览器绘制前同步拉取，切换会话时先取数据再渲染，
    // 避免空态/上一会话内容先闪一帧才替换成新会话
    useLayoutEffect(() => {
        // 拉取会话消息还原成对话记录落入 store（user/assistant 配对收敛在 utils/records 纯函数）
        // 首次加载只取最新 PAGE_SIZE 条，支持向上翻页
        const loadConversation = async (id: string) => {
            try {
                const detail = await getConversation(id, { limit: PAGE_SIZE })
                hydrateEntry(id, mapConversationDetail(detail), detail.has_more ?? false)
            } catch (e) {
                if (e instanceof AuthError) return
                // 会话不存在（过期/伪造的链接）：静默回新会话
                if (e instanceof ApiError && e.status === 404) {
                    navigate('/chat/new', { replace: true })
                    return
                }
                // 其他错误：toast 提示（与侧栏拉取失败保持一致的错误出口）
                addToast(buildNetworkError(e).message)
            }
        }

        routeIdRef.current = routeId
        // 新会话页无内容需要加载；发送失败的 entry 仅存于内存，刷新后以服务端数据为准（404 回新会话页）
        if (routeId === null) return
        // 会话内容已在 store（常驻缓存 + 并行流）：切走再切回不重拉、不打断后台流
        if (hasEntry(routeId)) return
        void loadConversation(routeId)
        // navigate 为路由库稳定引用，addToast 为 zustand 选择出的稳定 action，实际只随 routeId/authed 触发
    }, [routeId, authed, navigate, addToast])

    // 发送：新会话 id 前端生成并同步导航；落库确认（meta）后插侧栏
    const sendPrompt = (text: string) => {
        const origin = routeIdRef.current
        sendMessage({
            routeId: origin,
            prompt: text,
            onConversationId: (id) => {
                // 同步回调（发送瞬间 origin 必仍是前台会话）：立即导航对齐 URL
                if (origin === null) navigate(`/chat/${id}`, { replace: true })
            },
            onServerConfirmed: (id) => {
                // 服务端确认会话落库（meta 到达）：插入侧栏列表头
                if (origin === null) onConversationCreated(id, text.slice(0, 20))
            },
            onDone: onStreamEnded,
        })
    }

    // 重试：入口为用户消息气泡，传入的 userNodeId 即分支挂点（原回复保留，开新兄弟分支）。
    // 重试必在已有会话内，无新会话回调
    const retryPrompt = (prompt: string, userNodeId: string) => {
        const chatId = routeIdRef.current
        if (!chatId) return
        retryMessage({ chatId, prompt, retryParentId: userNodeId, onDone: onStreamEnded })
    }

    // 向上加载更多：滚动到顶部时触发，用当前最早的节点 id 作为游标
    // 返回是否真正插入了新内容（调用方据此决定是否需要等待 useLayoutEffect 补偿）
    const loadMore = async (): Promise<boolean> => {
        const chatId = routeIdRef.current
        if (!chatId) return false
        const entry = selectEntry(useChatStreams.getState(), chatId)
        if (!entry?.hasMore || !entry.oldestNodeId) return false
        try {
            const detail = await getConversation(chatId, { limit: PAGE_SIZE, beforeId: entry.oldestNodeId })
            const nodes = mapConversationDetail(detail)
            if (nodes.length) prependNodes(chatId, nodes, detail.has_more ?? false)
            return nodes.length > 0
        } catch (e) {
            if (e instanceof AuthError) return false
            addToast(buildNetworkError(e).message)
            return false
        }
    }

    return { sendPrompt, retryPrompt, loadMore }
}
