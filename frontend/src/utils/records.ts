import type { Dispatch, SetStateAction } from 'react'
import type { ChatRecord } from '../api/type'

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
