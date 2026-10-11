import { useCallback, useState } from 'react'
import ConversationItem from '../Content/ConversationItem'
import EmptyState from './EmptyState'
import type { ChatRecord } from '../../api/type'

type HistoryProps = {
    // 前端统一维护的对话记录（流式中的当前对话 + 历史对话）
    records: ChatRecord[]
    // 空状态建议问题点击后直接发送
    onSend: (text: string) => void
}

// 对话记录列表：数据由 App 统一维护，仅初次挂载和浏览器刷新时请求后端
export default function History({ records, onSend }: HistoryProps) {
    // 手动折叠思考过程的对话 id 集合，默认展开
    const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())

    // 引用稳定：配合 ConversationItem 的 memo，流式期间历史条目不重渲
    const toggleExpand = useCallback((id: string) => {
        setCollapsedIds((prev) => {
            const next = new Set(prev)
            if (next.has(id)) {
                next.delete(id)
            } else {
                next.add(id)
            }
            return next
        })
    }, [])

    // 无对话时展示空状态
    if (records.length === 0) {
        return <EmptyState onSend={onSend} />
    }

    return (
        <ul className="w-full py-3">
            {records.map((r) => (
                <li key={r.id} className="py-3">
                    <ConversationItem
                        record={r}
                        expanded={r.streaming === true || !collapsedIds.has(r.id)}
                        onToggle={toggleExpand}
                    />
                </li>
            ))}
        </ul>
    )
}
