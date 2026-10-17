import type { SessionMeta } from '../../api/type'

// 会话气泡小图标（列表项左侧）
function ChatIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`h-5 w-5 shrink-0 ${className ?? ''}`}>
            <path d="M21 12a8 8 0 0 1-8 8H4l2.5-3A8 8 0 1 1 21 12Z" />
        </svg>
    )
}

// 删除会话图标
function DeleteIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
        </svg>
    )
}

type SessionListProps = {
    sessions: SessionMeta[]
    // 当前会话 id（null 表示尚未落库的新会话）
    activeId: string | null
    // 流式生成中的会话 id 集合（Sidebar 订阅 store 后 join 成字符串保引用稳定）
    streamingIds: string
    onSelect: (id: string) => void
    onDelete: (id: string) => void
}

// 历史会话列表：会话条目渲染独立成组件，侧栏只负责布局编排
export default function SessionList({ sessions, activeId, streamingIds, onSelect, onDelete }: SessionListProps) {
    // Set 构造由 React Compiler 按 streamingIds 自动缓存
    const streamingSet = new Set(streamingIds.split(',').filter(Boolean))
    return (
        <ul className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {sessions.map((s) => {
                const active = s.id === activeId
                return (
                    // relative + group：删除按钮绝对定位右侧，hover 整行时显现
                    <li key={s.id} className="group relative">
                        <button
                            onClick={() => onSelect(s.id)}
                            title={s.title}
                            className={`mt-0.5 flex w-full items-center gap-2.5 rounded-xl py-2.5 pl-3 pr-10 text-left text-base transition-all ${
                                active
                                    ? 'bg-white font-medium text-blue-600 shadow-sm ring-1 ring-gray-100'
                                    : 'text-gray-600 hover:bg-blue-50/70 hover:text-blue-500'
                            }`}
                        >
                            {/* 选中蓝、平时灰、hover 提前的淡蓝 */}
                            <ChatIcon className={active ? 'text-blue-500' : 'text-gray-300 group-hover:text-blue-400'} />
                            <span className="truncate">{s.title}</span>
                            {/* 后台流式生成中：呼吸蓝点提示 */}
                            {streamingSet.has(s.id) && (
                                <span title="生成中" className="ml-auto h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-blue-500" />
                            )}
                        </button>
                        {/* 删除会话：hover 显现，与选择按钮是兄弟节点，点击不触发选择 */}
                        <button
                            onClick={() => onDelete(s.id)}
                            title="删除会话"
                            className="absolute right-1.5 top-1/2 mt-0.5 hidden -translate-y-1/2 rounded-lg p-1.5 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500 group-hover:block"
                        >
                            <DeleteIcon />
                        </button>
                    </li>
                )
            })}
        </ul>
    )
}