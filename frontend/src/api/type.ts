type ChatCompletionResponse = {
    // 单调递增的事件序号（meta=0），断线 resume 时据此向服务端索要之后的事件
    seq?: number
    conversation_id?: string
    // 首事件下发的树节点对齐信息（重试时 user_message_id 为 null）
    user_message_id?: string | null
    assistant_message_id?: string
    parent_message_id?: string | null
    reasoning_content?: string
    content?: string
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

// 会话树里平铺存储的单条消息（后端已为旧数据补 id/parent_id，前端仍防御性可选）
type StoredMessage = {
    role: 'user' | 'assistant'
    content: string
    reasoning?: string
    id?: string
    parent_id?: string | null
}

// 会话详情（切换会话时按 id 拉取）
type ConversationDetail = {
    id: string
    title: string
    messages: StoredMessage[]
    // 分页标记：是否还有更早的消息（仅分页请求时有值）
    has_more?: boolean
}

// 单次工具调用的状态（前端流式期间维护）
type ToolEvent = {
    id: string
    name: string
    status: 'running' | 'done' | 'error'
}

// 消息状态机：替代原来的 streaming 布尔 + error 字段组合。
// 单一状态来源，避免「正常完成」与「用户停止」都表现为 streaming=false 无法区分。
// pending → streaming → done/aborted/error 是合法流转；user 节点恒为 done。
export type MessageStatus = 'pending' | 'streaming' | 'done' | 'aborted' | 'error'

// 前端统一维护的对话记录（流式中的当前对话 + 历史对话共用同一结构）
type ChatRecord = {
    id: string
    prompt: string
    reasoning: string
    content: string
    // 消息生命周期状态（见 MessageStatus）
    status: MessageStatus
    // 工具调用状态列表（仅流式中的最后一项使用）
    toolEvents?: ToolEvent[]
    // 流式请求失败的提示（status === 'error' 时有值）
    error?: string
}

// 会话树节点：父指针树（不存 children，兄弟/后代按 parentId 查）
type ChatNode = {
    id: string
    parentId: string | null
    record: ChatRecord
}

export type { ChatCompletionResponse, SessionMeta, StoredMessage, ConversationDetail, ChatRecord, ToolEvent, ChatNode }
