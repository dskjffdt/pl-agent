type ChatCompletionResponse = {
    conversation_id?: string
    reasoning_content?: string
    content?: string
    finish_reason?: string
    // 工具调用事件（tool_start / tool_end）
    type?: 'tool_start' | 'tool_end'
    id?: string
    name?: string
    status?: string
}

// 侧栏会话条目（id 为后端生成的 UUIDv7，字符串形式）
type SessionMeta = {
    id: string
    title: string
    updated_at: string
}

// 会话里平铺存储的单条消息（user/assistant 相邻配对；assistant 可带思考过程）
type StoredMessage = {
    role: 'user' | 'assistant'
    content: string
    reasoning?: string
}

// 会话详情（切换会话时按 id 拉取）
type ConversationDetail = {
    id: string
    title: string
    messages: StoredMessage[]
}

// 单次工具调用的状态（前端流式期间维护）
type ToolEvent = {
    id: string
    name: string
    status: 'running' | 'done' | 'error'
}

// 前端统一维护的对话记录（流式中的当前对话 + 历史对话共用同一结构）
type ChatRecord = {
    id: string
    prompt: string
    reasoning: string[]
    content: string[]
    // 是否正在流式输出中
    streaming?: boolean
    // 逐字生长中的未完成文本（仅流式中的最后一项使用，打字机效果）
    growing?: { reasoning: string; content: string }
    // 工具调用状态列表（仅流式中的最后一项使用）
    toolEvents?: ToolEvent[]
    // 流式请求失败的提示（网络断、服务异常等）
    error?: string
    // 输入/输出命中违禁词被拦截（finish_reason = content_filter）
    filtered?: boolean
}

export type { ChatCompletionResponse, SessionMeta, ConversationDetail, ChatRecord, ToolEvent }
