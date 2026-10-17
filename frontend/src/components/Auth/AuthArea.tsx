import LoginModal from '../LoginModal/LoginModal'

// 退出登录图标
function LogoutIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
            <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
            <path d="m16 17 5-5-5-5" />
            <path d="M21 12H9" />
        </svg>
    )
}

type AuthAreaProps = {
    authed: boolean
    username: string | null
    onLogout: () => void
    // 登录成功：入参为后端返回的用户名，回调给 App 更新登录态并拉会话列表
    onLoginSuccess: (name: string) => void
}

// 登录登出统一入口：未登录渲染全屏登录弹窗，已登录渲染账号区（用户名 + 登出按钮）
export default function AuthArea({ authed, username, onLogout, onLoginSuccess }: AuthAreaProps) {
    if (!authed) return <LoginModal onSuccess={onLoginSuccess} />

    return (
        <div className="flex items-center gap-2 border-t border-gray-100 px-4 py-3">
            {/* 头像：用户名首字符 */}
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-sm font-medium text-white">
                {username?.[0]?.toUpperCase() ?? '?'}
            </div>
            <span className="min-w-0 flex-1 truncate text-base text-gray-600">{username}</span>
            <button
                onClick={onLogout}
                title="退出登录"
                className="shrink-0 rounded-lg p-1.5 text-gray-300 transition-colors hover:bg-red-50 hover:text-red-500"
            >
                <LogoutIcon />
            </button>
        </div>
    )
}