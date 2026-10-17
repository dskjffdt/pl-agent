import { useToast } from '../stores/useToast'

// 全局 toast 组件：订阅 Zustand store，单条 3 秒自动消失，支持手动关闭
export default function Toast() {
    const msg = useToast((s) => s.msg)
    const close = useToast((s) => s.close)
    if (!msg) return null
    return (
        <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center px-4">
            <div className="modal-in pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border border-gray-100 bg-white/95 py-2.5 pl-3.5 pr-2 text-sm text-gray-700 shadow-lg shadow-gray-900/5 backdrop-blur">
                {/* 警告图标：琥珀色圆底，弱化警示感，仅提示非阻塞 */}
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-500">
                    ⚠
                </span>
                <span className="flex-1 leading-snug">{msg}</span>
                <button
                    onClick={close}
                    aria-label="关闭提示"
                    className="shrink-0 rounded-lg p-1.5 text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-500"
                >
                    ✕
                </button>
            </div>
        </div>
    )
}
