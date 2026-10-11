import type { SessionMeta } from '../../api/type'

// 会话气泡小图标（列表项左侧）
function ChatIcon({ className }: { className?: string }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 shrink-0 ${className ?? ''}`}>
            <path d="M21 12a8 8 0 0 1-8 8H4l2.5-3A8 8 0 1 1 21 12Z" />
        </svg>
    )
}

// 退出登录图标
function LogoutIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
            <path d="m16 17 5-5-5-5" />
            <path d="M21 12H9" />
        </svg>
    )
}

type SidebarProps = {
    sessions: SessionMeta[]
    // 当前会话 id（null 表示尚未落库的新会话）
    activeId: string | null
    username: string | null
    onSelect: (id: string) => void
    onNew: () => void
    onLogout: () => void
}

// 侧栏：品牌行 + 新建会话 + 会话列表 + 账号区
export default function Sidebar({ sessions, activeId, username, onSelect, onNew, onLogout }: SidebarProps) {
    return (
        <aside className="flex w-[240px] shrink-0 flex-col border-r border-gray-100 bg-gray-50/60">
            {/* 品牌行：与登录弹窗同款 logo */}
            <div className="flex items-center gap-2 px-4 pb-1 pt-4">
                <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-br from-blue-400 to-blue-600">
                    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
                        <path d="M21 12a8 8 0 0 1-8 8H4l2.5-3A8 8 0 1 1 21 12Z" />
                    </svg>
                </div>
                <span className="text-sm font-semibold text-gray-800">PL Agent</span>
            </div>

            <div className="p-3 pt-2">
                <button
                    onClick={onNew}
                    className="w-full rounded-xl bg-blue-500 py-2 text-sm font-medium text-white shadow-sm shadow-blue-500/25 transition-all hover:bg-blue-600 hover:shadow-md hover:shadow-blue-500/25 active:scale-[0.98]"
                >
                    ＋ 新建会话
                </button>
            </div>

            <ul className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {sessions.map((s) => {
                    const active = s.id === activeId
                    return (
                        <li key={s.id}>
                            <button
                                onClick={() => onSelect(s.id)}
                                title={s.title}
                                className={`group mt-0.5 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-all ${
                                    active
                                        ? 'bg-white font-medium text-blue-600 shadow-sm ring-1 ring-gray-100'
                                        : 'text-gray-600 hover:bg-blue-50/70 hover:text-blue-500'
                                }`}
                            >
                                {/* 选中蓝、平时灰、hover 提前的淡蓝 */}
                                <ChatIcon className={active ? 'text-blue-500' : 'text-gray-300 group-hover:text-blue-400'} />
                                <span className="truncate">{s.title}</span>
                            </button>
                        </li>
                    )
                })}
            </ul>

            <div className="flex items-center gap-2 border-t border-gray-100 px-4 py-3">
                {/* 头像：用户名首字符 */}
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-xs font-medium text-white">
                    {username?.[0]?.toUpperCase() ?? '?'}
                </div>
                <span className="min-w-0 flex-1 truncate text-sm text-gray-600">{username}</span>
                <button
                    onClick={onLogout}
                    title="退出登录"
                    className="shrink-0 rounded-lg p-1.5 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500"
                >
                    <LogoutIcon />
                </button>
            </div>
        </aside>
    )
}
