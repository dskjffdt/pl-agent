import { useState, type ReactNode } from 'react'
import SessionList from './SessionList'
import ConfirmModal from '../ConfirmModal'
import type { SessionMeta } from '../../api/type'
import { useChatStreams } from '../../stores/chat'

type SidebarProps = {
    sessions: SessionMeta[]
    // 当前会话 id（null 表示尚未落库的新会话）
    activeId: string | null
    onSelect: (id: string) => void
    // 删除动作（请求 + store/路由清理）由 App 执行；确认弹窗的开关态收敛在侧栏内部
    onRequestDelete: (id: string) => void
    onNew: () => void
    // 底部插槽：登录登出区域（AuthArea）由 App 注入，侧栏不持有登录态逻辑
    footer?: ReactNode
}

// 侧栏（历史区）：品牌行 + 新建会话 + 历史会话列表 + 删除确认弹窗 + 底部插槽
// React Compiler 自动做 props 相等跳过：会话内容流式重渲期间，props 不变则整棵侧栏不渲染；
// 本组件对 store 的订阅（流式 id 集合）只在流开始/结束时变化，不随 token flush
export default function Sidebar({ sessions, activeId, onSelect, onRequestDelete, onNew, footer }: SidebarProps) {
    // 流式中的会话 id 集合：join 成字符串保证引用稳定，SessionList 内再转 Set
    const streamingIds = useChatStreams((s) => s.entries.filter((e) => e.streaming).map((e) => e.chatId).join(','))

    // 删除确认弹窗：纯交互态，唯一触发源在本组件列表内，无需上浮 App
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

    return (
        <aside className="flex w-[300px] shrink-0 flex-col border-r border-gray-100 bg-gray-50/60">
            {/* 品牌行：与登录弹窗同款 logo */}
            <div className="flex items-center gap-2.5 px-4 pb-1 pt-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-400 to-blue-600">
                    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
                        <path d="M21 12a8 8 0 0 1-8 8H4l2.5-3A8 8 0 1 1 21 12Z" />
                    </svg>
                </div>
                <span className="text-lg font-semibold text-gray-800">PL Agent</span>
            </div>

            <div className="p-3 pt-2">
                <button
                    onClick={onNew}
                    className="w-full rounded-xl bg-blue-600 py-2 text-sm font-medium text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-700 hover:shadow-md hover:shadow-blue-500/25 active:scale-[0.98]"
                >
                    ＋ 新建会话
                </button>
            </div>

            <SessionList
                sessions={sessions}
                activeId={activeId}
                streamingIds={streamingIds}
                onSelect={onSelect}
                onDelete={setPendingDeleteId}
            />

            {footer}

            {/* 删除会话确认：替换 window.confirm，支持自定义文案与键盘关闭 */}
            <ConfirmModal
                open={pendingDeleteId !== null}
                title="删除会话"
                message="确定删除该会话？删除后不可恢复"
                confirmText="删除"
                onConfirm={() => {
                    if (pendingDeleteId) onRequestDelete(pendingDeleteId)
                    setPendingDeleteId(null)
                }}
                onCancel={() => setPendingDeleteId(null)}
            />
        </aside>
    )
}
