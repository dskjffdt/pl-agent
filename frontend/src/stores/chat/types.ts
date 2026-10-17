import type { ChatNode } from '../../api/type'

// 每次 flush 投影的不可变会话快照
export type StreamEntry = {
    // 会话 id（entry 唯一键；新会话由前端生成，创建即确定、永不变更）
    chatId: string
    // 会话树：平铺节点（父指针树，不发散 children；兄弟/后代按 parentId 查）
    nodes: Map<string, ChatNode>
    // 当前展示分支的末端锚点：重试会产生多版本分叉，只有末端节点能唯一确定整条激活路径
    activeLeafId: string | null
    streaming: boolean
    // 分页：是否还有更早的消息可加载（首次加载后为 true 才可向上翻页）
    hasMore: boolean
    // 分页：当前已加载的最早节点 id（向上翻页时作为 before_id 游标）
    oldestNodeId: string | null
}

export type ChatStreamsState = {
    entries: StreamEntry[]
}

// 运行时可变状态（模块级 Map 按 chatId 键，不进 store；flush 时才投影为不可变 entry）
export type Runtime = {
    chatId: string
    // meta 只处理一次的防重入标记（resume 重放 meta 会再次触发 onMeta）
    confirmed: boolean
    controller: AbortController
    // 已完成节点（不可变，只在流收尾时并入）
    history: Map<string, ChatNode>
    // 流式中的最后一个节点（可变工作副本；record 字段整体替换、永不就地改历史）
    live: ChatNode
    // 帧合批调度句柄：同帧内多次 token/工具写入只排一次 rAF，null 表示未调度
    rafId: number | null
}

// 活跃路径投影（渲染用）：节点 + 直接子节点（user 节点的子节点即同一 prompt 的各回复版本）
export type PathItem = {
    node: ChatNode
    childIds: string[]
}

// 正常发送（新会话或会话内新一轮）
export type SendOptions = {
    // 当前会话 id（null = 新会话，内部生成 UUIDv7）
    routeId: string | null
    prompt: string
    // 新会话生成 id 后的同步通知（导航由调用方决定）；已有会话不触发
    onConversationId?: (id: string) => void
    // 服务端确认会话落库（meta 到达）后的通知（侧栏插入由调用方决定）；幂等只触发一次
    onServerConfirmed?: (id: string) => void
    // 流结束（成功/中止/报错）后的通知（侧栏刷新由调用方决定；登录过期不触发）
    onDone?: () => void
}

// 重试：在指定 user 节点下开兄弟回复分支（原回复保留），必发生在已有会话内
export type RetryOptions = {
    chatId: string
    prompt: string
    // 被重试 assistant 的父（user 节点）id，即新分支挂点
    retryParentId: string
    // 流结束（成功/中止/报错）后的通知
    onDone?: () => void
}
