import { Component, type ErrorInfo, type ReactNode } from 'react'

// 最小化 ErrorBoundary：捕获子树渲染崩溃与 lazy chunk 加载失败，
// 降级为全屏错误弹窗 + 刷新按钮，不让整页白屏
export default class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
    state = { hasError: false }

    static getDerivedStateFromError() {
        return { hasError: true }
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        if (import.meta.env.DEV) console.error('[ErrorBoundary]', error, info.componentStack)
    }

    private handleReload = () => {
        window.location.reload()
    }

    render() {
        if (this.state.hasError) {
            return (
                // 遮罩弹窗与 LoginModal 同款结构：全屏半透明 + 居中卡片
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                    <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
                        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-2xl">
                            ⚠
                        </div>
                        <h2 className="text-lg font-semibold text-gray-800">页面出现异常</h2>
                        <p className="mt-1 text-sm text-gray-500">请刷新页面重试</p>
                        <button
                            onClick={this.handleReload}
                            className="mt-5 w-full rounded-xl bg-blue-600 py-2 text-sm font-medium text-white transition-all hover:bg-blue-700 active:scale-[0.98]"
                        >
                            刷新页面
                        </button>
                    </div>
                </div>
            )
        }
        return this.props.children
    }
}
