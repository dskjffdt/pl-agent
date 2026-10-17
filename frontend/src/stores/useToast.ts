import { create } from 'zustand'

// 全局 toast store：单条 3 秒自动消失，支持用户手动关闭
type ToastState = {
    msg: string | null
    addMessage: (msg: string) => void
    close: () => void
}

let timer: ReturnType<typeof setTimeout> | null = null

export const useToast = create<ToastState>((set) => ({
    msg: null,
    addMessage: (msg) => {
        if (timer) clearTimeout(timer)
        set({ msg })
        timer = setTimeout(() => {
            set({ msg: null })
            timer = null
        }, 3000)
    },
    close: () => {
        if (timer) clearTimeout(timer)
        timer = null
        set({ msg: null })
    },
}))
