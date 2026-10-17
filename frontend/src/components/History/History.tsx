import ConversationItem from '../Content/ConversationItem'
import { isUserEntry } from '../../utils/records'
import type { PathItem } from '../../stores/chat'

type HistoryProps = {
    // 活跃分支路径（根 → 叶）投影：user 条目带其回复版本（直接子节点）
    items: PathItem[]
    // 会话流式中：用户气泡禁用重新生成（防同会话并发流）
    busy: boolean
    // 重试：在指定 user 节点下开新分支（原回复保留）
    onRetry: (prompt: string, userNodeId: string) => void
    // 分支切换：激活同一 prompt 下的某个回复版本（及其后代链尾）
    onSwitchBranch: (assistantNodeId: string) => void
}

// 对话记录列表（空状态由外层 ChatContent 渲染）：本组件只做路径投影的列表化
export default function History({ items, busy, onRetry, onSwitchBranch }: HistoryProps) {
    return (
        <ul className="w-full py-3">
            {items.map((item, i) => {
                const node = item.node
                const record = node.record
                const isUser = isUserEntry(record)
                // 当前展示版本：渲染路径中紧邻该 user 节点的 assistant 子节点
                const nextNode = items[i + 1]?.node
                const currentVersionId = isUser && nextNode?.parentId === node.id ? nextNode.id : null
                // 同一 prompt 的回复版本：user 取自身子节点；assistant 取路径中紧邻父 user 的子节点
                const parentItem = items[i - 1]
                const versions = isUser
                    ? item.childIds
                    : parentItem && parentItem.node.id === node.parentId
                      ? parentItem.childIds
                      : undefined
                return (
                    <li key={node.id} className="py-3">
                        <ConversationItem
                            record={record}
                            nodeId={node.id}
                            parentId={node.parentId}
                            busy={busy}
                            onRetry={onRetry}
                            versions={versions}
                            currentVersionId={currentVersionId}
                            onSwitchVersion={onSwitchBranch}
                        />
                    </li>
                )
            })}
        </ul>
    )
}
