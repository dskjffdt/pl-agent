import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AuthError, getUsername, logout, subscribeUnauthorized } from './api/auth'
import { deleteConversation, getConversation, listConversations, streamChat } from './api/chat'
import type { ChatRecord, SessionMeta } from './api/type'
import Chat from './components/Chat/Chat'
import ChatContent from './components/ChatContent/ChatContent'
import LoginModal from './components/LoginModal/LoginModal'
import Sidebar from './components/Sidebar/Sidebar'
import { useTypewriter } from './hooks/useTypewriter'
import { updateLastRecord } from './utils/records'

function App() {
    const navigate = useNavigate()
    // URL 是会话路由的事实源：/ 与 /chat/new 为新会话，/chat/:id 直达已有会话（UUIDv7）
    const params = useParams()
    const routeId = params.id && params.id !== 'new' ? params.id : null

    // 登录态：凭证在 HttpOnly cookie，前端用 username 初判；无记录直接弹登录框，
    // cookie 实际过期时首个请求 401 也会回到这里
    const [authed, setAuthed] = useState(() => Boolean(getUsername()))
    const [username, setUsername] = useState(() => getUsername())
    // 侧栏会话列表
    const [sessions, setSessions] = useState<SessionMeta[]>([])
    const [sending, setSending] = useState(false)
    // 当前会话的对话记录
    const [records, setRecords] = useState<ChatRecord[]>([])
    // 打字机引擎：SSE 文本经它逐字揭示成块；paused/togglePause 控制暂停与继续
    const { reset, enqueue, finish, stop, paused, togglePause } = useTypewriter(setRecords, () => setSending(false))
    // 停止生成：中断当前流式请求
    const abortRef = useRef<AbortController | null>(null)
    // 会话 id 在流式请求中途才下发，sendPrompt 闭包里读不到最新值，用 ref 兜底
    const activeIdRef = useRef<string | null>(null)
    // 已加载进 records 的会话 id：新会话落库后 URL replace 回来时不重复拉取
    const loadedIdRef = useRef<string | null>(null)

    // 拉取当前用户的会话列表（侧栏）
    async function loadSessions() {
        try {
            setSessions(await listConversations())
        } catch (e) {
            if (!(e instanceof AuthError)) console.error(e)
        }
    }

    // 拉取会话消息并按 user/assistant 相邻配对还原成对话记录
    async function loadConversation(id: string) {
        try {
            const detail = await getConversation(id)
            const mapped: ChatRecord[] = []
            for (const m of detail.messages) {
                if (m.role === 'user') {
                    mapped.push({
                        id: `c${detail.id}-${mapped.length}`,
                        prompt: m.content,
                        reasoning: [],
                        content: [],
                    })
                } else {
                    const last = mapped[mapped.length - 1]
                    if (last) {
                        last.reasoning = m.reasoning ? [m.reasoning] : []
                        last.content = [m.content]
                    }
                }
            }
            setRecords(mapped)
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

    // 初次挂载：已登录则拉会话列表；订阅 401 事件（任何请求过期都回到登录弹窗）
    useEffect(() => {
        if (getUsername()) loadSessions()
        // 订阅返回取消订阅函数，作为 cleanup
        return subscribeUnauthorized(() => {
            setAuthed(false)
            setRecords([])
            loadedIdRef.current = null
            navigate('/chat/new', { replace: true })
        })
    }, [])

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

    // 登录成功：留在当前 URL；若直达的是已有会话则恢复其内容（authed 变化触发上面的加载 effect）
    function handleLoginSuccess(name: string) {
        setAuthed(true)
        setUsername(name)
        loadSessions()
    }

    async function handleLogout() {
        // logout 请求后端清 HttpOnly cookie，并触发 401 广播清空会话状态
        await logout()
        setSessions([])
        setUsername(null)
    }

    // 新建会话：URL 切到 /chat/new，会话 id 等首条消息发送后由后端下发
    function handleNewChat() {
        navigate('/chat/new')
    }

    function handleSelect(id: string) {
        navigate(`/chat/${id}`)
    }

    // 删除会话：成功后移出侧栏；删的是当前会话则回新会话
    // （路由 effect 会自动中止进行中的生成并清空记录，无需在这里处理）
    async function handleDelete(id: string) {
        if (!window.confirm('确定删除该会话？删除后不可恢复')) return
        try {
            await deleteConversation(id)
        } catch (e) {
            if (!(e instanceof AuthError)) console.error(e)
            return
        }
        setSessions((prev) => prev.filter((s) => s.id !== id))
        if (id === activeIdRef.current) navigate('/chat/new', { replace: true })
    }

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
                    setSessions((prev) =>
                        prev.some((s) => s.id === id)
                            ? prev
                            : [{ id, title: text.slice(0, 20), updated_at: new Date().toISOString() }, ...prev],
                    )
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
    function handleStop() {
        abortRef.current?.abort()
        stop()
    }

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
                <Chat onSend={sendPrompt} sending={sending} onStop={handleStop} paused={paused} onTogglePause={togglePause} />
            </div>
            {/* 无登录态时全屏弹窗登录 */}
            {!authed && <LoginModal onSuccess={handleLoginSuccess} />}
        </div>
    )
}

export default App
