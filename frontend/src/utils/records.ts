import type { Dispatch, SetStateAction } from 'react'
import type { ChatRecord, ConversationDetail } from '../api/type'

// 会话详情（平铺消息）→ 对话记录：user/assistant 相邻配对，assistant 回填到最后一条记录
export function mapConversationDetail(detail: ConversationDetail): ChatRecord[] {
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
    return mapped
}

// 就地更新最后一条记录（流式中的当前对话），无记录时静默跳过
export function updateLastRecord(
    setRecords: Dispatch<SetStateAction<ChatRecord[]>>,
    updater: (last: ChatRecord) => void,
) {
    setRecords((prev) => {
        if (prev.length === 0) return prev
        const next = prev.slice()
        const last = { ...next[next.length - 1] }
        updater(last)
        next[next.length - 1] = last
        return next
    })
}
