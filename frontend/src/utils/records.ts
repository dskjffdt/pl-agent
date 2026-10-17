import type { ChatNode, ChatRecord, ConversationDetail, MessageStatus } from '../api/type'

// 是否 user 节点条目：user 消息恒为 done 状态，无思考/回答/工具/错误
export function isUserEntry(record: ChatRecord): boolean {
    return record.status === 'done' && !record.error && record.content.length === 0 && record.reasoning.length === 0 && !record.toolEvents?.length
}

// 会话详情（平铺树节点消息）→ 树节点列表：每个消息一个节点，父链自关联；
// 旧数据缺 id/parent_id 时按线序补链（后端已补，此处防御性兜底）。
// 历史消息均已落库，状态固定为 done。
export function mapConversationDetail(detail: ConversationDetail): ChatNode[] {
    const nodes: ChatNode[] = []
    let lastUserPrompt = ''
    for (const m of detail.messages) {
        const id = m.id ?? `n${detail.id}-${nodes.length}`
        const parentId = m.parent_id ?? (nodes.length ? nodes[nodes.length - 1].id : null)
        const status: MessageStatus = 'done'
        if (m.role === 'user') {
            lastUserPrompt = m.content
            nodes.push({ id, parentId, record: { id, prompt: m.content, reasoning: '', content: '', status } })
        } else {
            nodes.push({
                id,
                parentId,
                record: { id, prompt: lastUserPrompt, reasoning: m.reasoning ?? '', content: m.content, status },
            })
        }
    }
    return nodes
}