import { useState } from 'react'
import { login } from '../../api/auth'

// 输入框左侧装饰图标（stroke 继承文字色，聚焦时随容器变蓝）
function UserIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-[18px] w-[18px]">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
        </svg>
    )
}

function LockIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-[18px] w-[18px]">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
    )
}

// 密码可见性切换
function EyeIcon({ off }: { off?: boolean }) {
    return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-[18px] w-[18px]">
            <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z" />
            <circle cx="12" cy="12" r="3" />
            {off && <path d="M4 4l16 16" />}
        </svg>
    )
}

function SpinnerIcon() {
    return (
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 animate-spin">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
    )
}

// 输入框统一样式：左图标占位 pl-11，聚焦时描边 + 柔和光圈
const inputClass =
    'w-full rounded-xl border border-gray-200 bg-gray-50/50 py-3 pl-11 pr-4 text-sm text-gray-900 transition-all placeholder:text-gray-300 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-blue-500/10'

// 登录弹窗：无登录态时全屏遮罩强制登录，不支持关闭（内置账号见后端 .env 配置）
export default function LoginModal({ onSuccess }: { onSuccess: (username: string) => void }) {
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [showPwd, setShowPwd] = useState(false)
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!username.trim() || !password || loading) return
        setLoading(true)
        setError('')
        try {
            const name = await login(username.trim(), password)
            onSuccess(name)
        } catch (err) {
            // 后端 detail（如「用户名或密码错误」）透传；网络异常给通用提示
            const msg = err instanceof Error ? err.message : ''
            setError(msg && !msg.includes('fetch') ? msg : '登录失败，请检查网络或后端服务')
        } finally {
            setLoading(false)
        }
    }

    return (
        // 遮罩：淡入 + 背景模糊，卡片入场走 modal-in
        <div className="fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-md">
            <form
                onSubmit={handleSubmit}
                className="modal-in w-[360px] rounded-3xl bg-white p-8 shadow-2xl shadow-black/20"
            >
                {/* 品牌区：渐变 logo + 应用名 */}
                <div className="flex flex-col items-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-400 to-blue-600 shadow-lg shadow-blue-500/30">
                        <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                            <path d="M21 12a8 8 0 0 1-8 8H4l2.5-3A8 8 0 1 1 21 12Z" />
                        </svg>
                    </div>
                    <h1 className="mt-4 text-lg font-semibold text-gray-900">PL Agent</h1>
                    <p className="mt-1 text-sm text-gray-400">内部 AI 助手 · 登录后继续</p>
                </div>

                <label className="group relative mt-6 block">
                        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 transition-colors group-focus-within:text-blue-500">
                            <UserIcon />
                        </span>
                        <input
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            placeholder="用户名"
                            autoComplete="username"
                            autoFocus
                            className={inputClass}
                        />
                    </label>
                    <label className="relative mt-3 block">
                        <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-gray-300">
                            <LockIcon />
                        </span>
                        <input
                            type={showPwd ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="密码"
                            autoComplete="current-password"
                            className={`${inputClass} pr-11`}
                        />
                        <button
                            type="button"
                            onClick={() => setShowPwd((v) => !v)}
                            title={showPwd ? '隐藏密码' : '显示密码'}
                            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-300 transition-colors hover:text-gray-500"
                        >
                            <EyeIcon off={showPwd} />
                        </button>
                    </label>

                    {/* 登录失败提示：key 绑定 error，重复出错时重新触发抖动动画 */}
                    {error && (
                        <div
                            key={error}
                            className="shake mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-500"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mt-0.5 h-3.5 w-3.5 shrink-0">
                                <circle cx="12" cy="12" r="9" />
                                <path d="M12 7v6" />
                                <path d="M12 16.5v.5" />
                            </svg>
                            <span>{error}</span>
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading || !username.trim() || !password}
                        className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-500 py-3 text-sm font-medium text-white shadow-sm shadow-blue-500/30 transition-all hover:bg-blue-600 hover:shadow-md hover:shadow-blue-500/30 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-300 disabled:shadow-none"
                    >
                        {loading && <SpinnerIcon />}
                        {loading ? '登录中…' : '登 录'}
                    </button>

                <p className="mt-6 border-t border-gray-100 pt-4 text-center text-xs text-gray-300">
                    内部系统 · 仅限授权账号使用
                </p>
            </form>
        </div>
    )
}
