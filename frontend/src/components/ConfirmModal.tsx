import { useEffect } from 'react'

type Props = {
    open: boolean
    title: string
    message: string
    confirmText?: string
    cancelText?: string
    onConfirm: () => void
    onCancel: () => void
}

// 可访问的确认弹窗：替换 window.confirm，支持自定义文案、ESC 关闭、aria-label
export default function ConfirmModal({
    open,
    title,
    message,
    confirmText = '确定',
    cancelText = '取消',
    onConfirm,
    onCancel,
}: Props) {
    useEffect(() => {
        if (!open) return
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onCancel()
        }
        window.addEventListener('keydown', handler)
        return () => window.removeEventListener('keydown', handler)
    }, [open, onCancel])

    if (!open) return null
    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={onCancel}
        >
            <div
                className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <h2 id="confirm-title" className="text-base font-semibold text-gray-900">
                    {title}
                </h2>
                <p className="mt-2 text-sm text-gray-600">{message}</p>
                <div className="mt-5 flex justify-end gap-2">
                    <button
                        onClick={onCancel}
                        className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-700"
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    )
}
