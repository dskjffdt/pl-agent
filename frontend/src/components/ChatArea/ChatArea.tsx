import { useNavigate } from 'react-router-dom'
import Chat from '../Chat/Chat'
import ChatContent from '../ChatContent/ChatContent'
import { useChatSession } from '../../hooks/useChatSession'
import { useAuthStore } from '../../stores/useAuthStore'

type ChatAreaProps = {
    // 当前会话 id（null = 新会话）
    routeId: string | null
    // 新会话落库后插入侧栏列表头（侧栏数据归 App 管，容器只上报事件）
    onConversationCreated: (id: string, title: string) => void
    // 每条流结束后刷新侧栏（标题自动生成/排序变化回显）
    onStreamEnded: () => void
}

// 聊天区容器：会话编排 hook 收敛在本组件内，对话区/输入区只拿各自需要的回调
export default function ChatArea({ routeId, onConversationCreated, onStreamEnded }: ChatAreaProps) {
    const navigate = useNavigate()
    const authed = useAuthStore((s) => s.authed)
    const { sendPrompt, retryPrompt, loadMore } = useChatSession({
        routeId,
        authed,
        navigate,
        onConversationCreated,
        onStreamEnded,
    })

    return (
        <div className="flex min-w-0 flex-1 flex-col">
            <ChatContent routeId={routeId} onSend={sendPrompt} onRetry={retryPrompt} onLoadMore={loadMore} />
            <Chat routeId={routeId} onSend={sendPrompt} />
        </div>
    )
}
