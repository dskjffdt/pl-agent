import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AuthError, getUsername, logout, subscribeUnauthorized } from './api/auth'
import { deleteConversation } from './api/chat'
import Chat from './components/Chat/Chat'
import ChatContent from './components/ChatContent/ChatContent'
import LoginModal from './components/LoginModal/LoginModal'
import Sidebar from './components/Sidebar/Sidebar'
import { useChatSession } from './hooks/useChatSession'
import { useSessions } from './hooks/useSessions'

function App() {
    const navigate = useNavigate()
    // URL 是会话路由的事实源：/ 与 /chat/new 为新会话，/chat/:id 直达已有会话（UUIDv7）
    const params = useParams()
    const routeId = params.id && params.id !== 'new' ? params.id : null

    // 登录态：凭证在 HttpOnly cookie，前端用 username 初判；无记录直接弹登录框，
    // cookie 实际过期时首个请求 401 也会回到这里
    const [authed, setAuthed] = useState(() => Boolean(getUsername()))
    const [username, setUsername] = useState(() => getUsername())

    // 侧栏会话列表与会话内容/流式对话分属两个 hook，App 只做编排
    const { sessions, loadSessions, prependSession, removeSession, clearSessions } = useSessions()
    const { records, sending, paused, togglePause, sendPrompt, stopGeneration, resetContent, isActive } =
        useChatSession({ routeId, authed, navigate, onConversationCreated: prependSession })

    // 初次挂载：已登录则拉会话列表；订阅 401 事件（任何请求过期都回到登录弹窗）
    useEffect(() => {
        if (getUsername()) loadSessions()
        // 订阅返回取消订阅函数，作为 cleanup
        return subscribeUnauthorized(() => {
            setAuthed(false)
            resetContent()
            navigate('/chat/new', { replace: true })
        })
    }, [])

    // 传给 Sidebar 的 handler 全部 useCallback 固定引用：Sidebar 包 memo 后，
    // 流式期间 App 每 tick 重渲时侧栏凭浅比较直接跳过，列表零重渲
    const handleLoginSuccess = useCallback(
        (name: string) => {
            // 留在当前 URL；若直达的是已有会话则恢复其内容（authed 变化触发 chat hook 的路由同步 effect）
            setAuthed(true)
            setUsername(name)
            loadSessions()
        },
        [loadSessions],
    )

    const handleLogout = useCallback(async () => {
        // logout 请求后端清 HttpOnly cookie，内部触发 401 广播：清 authed、清会话内容、回新会话
        await logout()
        clearSessions()
        setUsername(null)
    }, [clearSessions])

    // 新建会话：URL 切到 /chat/new，会话 id 等首条消息发送后由后端下发
    const handleNewChat = useCallback(() => navigate('/chat/new'), [navigate])

    const handleSelect = useCallback((id: string) => navigate(`/chat/${id}`), [navigate])

    // 删除会话：成功后移出侧栏；删的是当前会话则回新会话
    // （路由同步 effect 会自动中止进行中的生成并清空记录）
    const handleDelete = useCallback(
        async (id: string) => {
            if (!window.confirm('确定删除该会话？删除后不可恢复')) return
            try {
                await deleteConversation(id)
            } catch (e) {
                if (!(e instanceof AuthError)) console.error(e)
                return
            }
            removeSession(id)
            if (isActive(id)) navigate('/chat/new', { replace: true })
        },
        [removeSession, isActive, navigate],
    )

    return (
        <div className="flex h-[100dvh] overflow-hidden">
            <Sidebar
                sessions={sessions}
                activeId={routeId}
                username={username}
                onSelect={handleSelect}
                onDelete={handleDelete}
                onNew={handleNewChat}
                onLogout={handleLogout}
            />
            <div className="flex min-w-0 flex-1 flex-col">
                <ChatContent records={records} onSend={sendPrompt} />
                <Chat
                    onSend={sendPrompt}
                    sending={sending}
                    onStop={stopGeneration}
                    paused={paused}
                    onTogglePause={togglePause}
                />
            </div>
            {/* 无登录态时全屏弹窗登录 */}
            {!authed && <LoginModal onSuccess={handleLoginSuccess} />}
        </div>
    )
}

export default App
