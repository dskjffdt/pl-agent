import { AuthError, handleUnauthorized } from './auth'
import type { ChatCompletionResponse, ConversationDetail, SessionMeta } from './type'

// 401 统一出口：清凭证广播后抛 AuthError
function unauthorized(): never {
    handleUnauthorized()
    throw new AuthError('登录已过期')
}

// 会话列表（侧栏）。凭证在 HttpOnly cookie 里，同源请求自动携带
export async function listConversations(): Promise<SessionMeta[]> {
    const res = await fetch('/conversations')
    if (res.status === 401) unauthorized()
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as SessionMeta[]
}

// 会话详情（切换会话时拉取完整消息）
export async function getConversation(id: string): Promise<ConversationDetail> {
    const res = await fetch(`/conversations/${id}`)
    if (res.status === 401) unauthorized()
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as ConversationDetail
}

type StreamHandlers = {
    // 首个事件下发会话 id（新建会话时前端据此挂到侧栏）
    onConversationId: (id: string) => void
    // 正文/思考文本（走打字机缓冲，可能为空串）
    onText: (reasoning: string, content: string) => void
    // 工具调用开始（离散事件，直接更新记录）
    onToolStart: (id: string, name: string) => void
    // 工具调用结束
    onToolEnd: (id: string, status: 'done' | 'error') => void
    // 输出命中违禁词被截断（finish_reason = content_filter）
    onFiltered: () => void
}

// 流式对话：请求 SSE 并按行解析，文本与工具事件通过回调上抛，网络/解析异常直接抛给调用方
// signal 用于停止生成（AbortController），中断时 reader.read 抛 AbortError
export async function streamChat(
    prompt: string,
    conversationId: string | null,
    signal: AbortSignal,
    { onConversationId, onText, onToolStart, onToolEnd, onFiltered }: StreamHandlers,
) {
    const res = await fetch('/chat/completions', {
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
        body: JSON.stringify({ prompt, conversation_id: conversationId }),
        signal,
    })
    if (res.status === 401) unauthorized()
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    const handleData = (data: ChatCompletionResponse) => {
        if (data.conversation_id) onConversationId(data.conversation_id)
        if (data.finish_reason === 'content_filter') {
            onFiltered()
            return
        }
        onText(data.reasoning_content ?? '', data.content ?? '')

        // 工具调用事件不走打字机缓冲
        const { type, id, name, status } = data
        if (type === 'tool_start' && id && name) onToolStart(id, name)
        if (type === 'tool_end' && id) onToolEnd(id, status === 'error' ? 'error' : 'done')
    }

    while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()!
        for (const line of lines) {
            if (!line.trim()) continue
            handleData(JSON.parse(line) as ChatCompletionResponse)
        }
    }

    // 处理循环后残留数据
    if (buffer.trim()) {
        try {
            handleData(JSON.parse(buffer) as ChatCompletionResponse)
        } catch {
            /* 残留不是合法 JSON，忽略 */
        }
    }
}
