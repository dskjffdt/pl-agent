import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 登录态 store：收敛 localStorage 凭证标记 + subscribeUnauthorized 广播逻辑
// HttpOnly cookie 是真实凭证（JS 不可读），store 只存 username 作为 UI 初判，
// 真实凭证是否有效以接口 401 为准——401 时 authError() 清 store 并广播
type AuthState = {
    username: string | null
    authed: boolean
    login: (username: string) => void
    logout: () => void
    // 401 统一出口：清凭证 + 广播（chat.ts 的 401 回调调用）
    authError: () => void
}

// 401 广播：任何请求返回 401 时通知订阅者（App 弹出登录框）
// 保留事件机制是因为 store 订阅只能拿到 state 变化，无法区分"手动登出"和"401 过期"
type Listener = () => void
const listeners = new Set<Listener>()

export function subscribeUnauthorized(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set) => ({
            username: null,
            authed: false,
            // persist 中间件在 set 后自动把 partialize 结果落盘 plagent_auth，无需手动读写 localStorage
            login: (username) => set({ username, authed: true }),
            logout: () => set({ username: null, authed: false }),
            authError: () => {
                set({ username: null, authed: false })
                listeners.forEach((l) => l())
            },
        }),
        {
            // persist 只持久化 username/authed，authError/login/logout 不存
            name: 'plagent_auth',
            partialize: (state) => ({ username: state.username, authed: state.authed }),
        },
    ),
)

// 跨标签页同步：storage 事件只在本 tab 写入时通知**其他** tab
// （本 tab 的 login/logout/authError 已各自 set，无需再触发）
// 收到通知后读 persist 落盘的最新 JSON，直接 setState 对齐 store
window.addEventListener('storage', (e) => {
    if (e.key !== 'plagent_auth') return
    try {
        const next = e.newValue ? (JSON.parse(e.newValue).state as AuthState) : null
        useAuthStore.setState({
            username: next?.username ?? null,
            authed: next?.authed ?? false,
        })
    } catch {
        // persist 写入的 JSON 解析失败视为登出态，避免其他 tab 卡在旧登录态
        useAuthStore.setState({ username: null, authed: false })
    }
})
