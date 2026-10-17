import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AuthError } from './api/auth'
import { deleteConversation } from './api/chat'
import AuthArea from './components/Auth/AuthArea'
import ChatArea from './components/ChatArea/ChatArea'
import Sidebar from './components/Sidebar/Sidebar'
import Toast from './components/Toast'
import { useSessions } from './hooks/useSessions'
import { subscribeUnauthorized, useAuthStore } from './stores/useAuthStore'
import { discardAll, discardEntry } from './stores/chat'
import { useToast } from './stores/useToast'
import { buildNetworkError } from './utils/apiError'

function App() {
    const navigate = useNavigate()
    // URL 是会话路由的事实源：/ 与 /chat/new 为新会话，/chat/:id 直达已有会话（UUIDv7）
    const params = useParams()
    const routeId = params.id && params.id !== 'new' ? params.id : null

    // 登录态收敛到 Zustand store：persist 自动从 localStorage 恢复
    const authed = useAuthStore((s) => s.authed)
    const username = useAuthStore((s) => s.username)
    const login = useAuthStore((s) => s.login)
    const logout = useAuthStore((s) => s.logout)

    // 全局 toast store
    const addToast = useToast((s) => s.addMessage)

    // 侧栏会话列表；会话内容/流式编排已下沉到 ChatArea，App 只做顶层区块编排
    const { sessions, loadSessions, prependSession, removeSession, clearSessions } = useSessions()

    // 登录态变化 → 拉会话列表：覆盖 localStorage 恢复（挂载即 true）与登录成功（false→true）两条路径
    useEffect(() => {
        if (authed) loadSessions()
    }, [authed, loadSessions])

    // 订阅 401 事件（任何请求过期都回到登录弹窗）：navigate 为稳定引用，订阅仅挂载时建立一次
    useEffect(() => {
        // 订阅返回取消订阅函数，作为 cleanup
        return subscribeUnauthorized(() => {
            discardAll()
            navigate('/chat/new', { replace: true })
        })
    }, [navigate])

    // 登录态就绪即预热 Markdown 渲染 chunk（覆盖登录成功与 localStorage 恢复两条路径）：
    // 与拉会话列表并行下载，消息区渲染时 chunk 已就绪，Suspense 无感
    useEffect(() => {
        if (authed) import('./components/Content/MarkdownBlock')
    }, [authed])

    // 传给 Sidebar 的 handler：React Compiler 自动按依赖缓存引用，无需手写 useCallback
    // 会话列表由上方「authed 变化」effect 统一拉取，此处只翻转登录态
    const handleLoginSuccess = (name: string) => {
        login(name)
    }

    const handleLogout = async () => {
        try {
            await logout()
        } catch (e) {
            if (e instanceof AuthError) return
            addToast(buildNetworkError(e).message)
            return
        }
        clearSessions()
    }

    // 新建会话：URL 切到 /chat/new，会话 id 等首条消息发送后由后端下发
    const handleNewChat = () => navigate('/chat/new')

    const handleSelect = (id: string) => navigate(`/chat/${id}`)

    // 删除会话（确认弹窗由 Sidebar 自管）：请求成功后移侧栏、清内容；
    // 删的是当前会话则回新会话（路由同步 effect 会自动中止进行中的生成并清空记录）
    const handleDeleteSession = async (id: string) => {
        try {
            await deleteConversation(id)
        } catch (e) {
            if (e instanceof AuthError) return
            addToast(buildNetworkError(e).message)
            return
        }
        removeSession(id)
        // 会话内容/后台流在 store 里：中断该会话可能进行中的流并移除 entry
        discardEntry(id)
        if (id === routeId) navigate('/chat/new', { replace: true })
    }

    return (
        <div className="flex h-[100dvh] overflow-hidden">
            <Sidebar
                sessions={sessions}
                activeId={routeId}
                onSelect={handleSelect}
                onRequestDelete={handleDeleteSession}
                onNew={handleNewChat}
                footer={
                    <AuthArea
                        authed={authed}
                        username={username}
                        onLogout={handleLogout}
                        onLoginSuccess={handleLoginSuccess}
                    />
                }
            />
            {/* 聊天区：内部自持会话编排 hook（发送/重试/历史加载），落库后通过回调上报侧栏；
                流结束后刷新列表（loadSessions 幂等，标题未变零重渲） */}
            <ChatArea
                routeId={routeId}
                onConversationCreated={prependSession}
                onStreamEnded={loadSessions}
            />
            {/* 全局 toast：侧栏拉取/删除失败等非流式错误 */}
            <Toast />
        </div>
    )
}

export default App
