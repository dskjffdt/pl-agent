import { useAuthStore } from '../stores/useAuthStore'
import { buildApiError } from '../utils/apiError'
import { API_BASE } from '../config'

// 401 时先广播再抛 AuthError，调用方凭 AuthError 静默跳过错误提示（登录框已接管）
export class AuthError extends Error {}

// 401 统一出口：清 store 凭证并广播（App 订阅后弹登录框）
export function handleUnauthorized(): void {
    useAuthStore.getState().authError()
}

export async function login(username: string, password: string): Promise<string> {
    const res = await fetch(`${API_BASE}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
        throw await buildApiError(res)
    }
    // 登录成功：HttpOnly cookie 已由后端 Set-Cookie 下发，store 记录 username + authed
    const data = (await res.json()) as { username: string }
    useAuthStore.getState().login(data.username)
    return data.username
}

export async function logout(): Promise<void> {
    // 后端清 HttpOnly cookie（前端 JS 清不掉），必须等返回成功再清前端状态。
    // 网络断了后端 cookie 没清，前端不该假装登出——否则下次请求还带旧 cookie，
    // 后端回 401 → 登录弹窗 → 用户困惑"我不是刚登出吗"
    const res = await fetch(`${API_BASE}/logout`, { method: 'POST' })
    if (!res.ok) throw await buildApiError(res)
    useAuthStore.getState().logout()
}
