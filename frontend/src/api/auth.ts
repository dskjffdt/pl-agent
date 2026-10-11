// token 由后端写入 HttpOnly cookie（JS 不可读，防 XSS 窃取），
// 前端只维护 username 作为 UI 登录态初判；真实凭证是否有效以接口 401 为准
const USERNAME_KEY = 'plagent_username'

// 未授权广播：任何请求返回 401 时清本地登录态并通知订阅者（App 弹出登录框）
type Listener = () => void
const listeners = new Set<Listener>()

export function getUsername(): string | null {
    return localStorage.getItem(USERNAME_KEY)
}

// 订阅未授权事件，返回取消订阅函数
export function subscribeUnauthorized(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

// 请求返回 401 的统一出口：清登录态 + 广播（App 收到后回到登录弹窗）
// chat.ts 自定义 401 处理时也会复用
export function handleUnauthorized(): void {
    localStorage.removeItem(USERNAME_KEY)
    listeners.forEach((l) => l())
}

// 401 时先广播再抛错，调用方凭 AuthError 静默跳过错误提示（登录框已接管）
export class AuthError extends Error {}

function unauthorized(): never {
    handleUnauthorized()
    throw new AuthError('登录已过期')
}

export async function login(username: string, password: string): Promise<string> {
    const res = await fetch('/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
    })
    if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { detail?: string } | null
        throw new Error(data?.detail ?? '登录失败，请稍后重试')
    }
    // 登录成功：HttpOnly cookie 已由后端 Set-Cookie 下发，前端只记录用户名
    const data = (await res.json()) as { username: string }
    localStorage.setItem(USERNAME_KEY, data.username)
    return data.username
}

export async function logout(): Promise<void> {
    // 后端清除 HttpOnly cookie（前端 JS 清不掉），再清本地登录态
    await fetch('/logout', { method: 'POST' }).catch(() => {})
    localStorage.removeItem(USERNAME_KEY)
    handleUnauthorized()
}
