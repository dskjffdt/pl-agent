import { useEffect, useRef } from 'react'

// 输入框最大高度：超过后内部滚动，不再撑高
const MAX_HEIGHT = 300

function Input({
    prompt,
    handleChangePrompt,
    handleClick,
    handleStop,
    sending,
}: {
    prompt: string
    handleChangePrompt: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
    handleClick: () => void
    handleStop: () => void
    sending: boolean
}) {
    const textareaRef = useRef<HTMLTextAreaElement>(null)

    // 高度自适应：每次内容变化先收缩到 auto 再取 scrollHeight，单行起步、封顶 MAX_HEIGHT
    useEffect(() => {
        const el = textareaRef.current
        if (!el) return
        el.style.height = 'auto'
        el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
    }, [prompt])

    return (
        <div className="relative w-full shrink-0 rounded-2xl border border-gray-200 bg-white p-[16px] pr-[56px] shadow-sm transition-all focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/10">
            <textarea
                ref={textareaRef}
                className="w-full min-h-[144px] resize-none focus:outline-none"
                placeholder="给 AI 发送消息…"
                onChange={handleChangePrompt}
                onKeyDown={(e) => {
                    // Enter 发送，Shift+Enter 换行
                    if (e.key === 'Enter' && !e.shiftKey && !sending) {
                        e.preventDefault()
                        handleClick()
                    }
                }}
                value={prompt}
            ></textarea>
            {sending ? (
                // 生成中：按钮变停止（中断当前流式请求，已生成内容保留）
                <button
                    onClick={handleStop}
                    title="停止生成"
                    className="absolute bottom-[14px] right-[16px] flex h-[36px] w-[36px] items-center justify-center rounded-full bg-gray-900 text-white transition-all hover:bg-gray-700 active:scale-90"
                >
                    <span className="block h-[12px] w-[12px] rounded-[2px] bg-white"></span>
                </button>
            ) : (
                <button
                    onClick={handleClick}
                    disabled={!prompt.trim()}
                    className="absolute bottom-[14px] right-[16px] flex h-[36px] w-[36px] items-center justify-center rounded-full bg-blue-500 text-[20px] text-white shadow-sm shadow-blue-500/30 transition-all hover:bg-blue-600 hover:shadow-md hover:shadow-blue-500/30 active:scale-90 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-300 disabled:shadow-none"
                >
                    ↑
                </button>
            )}
        </div>
    )
}

export default Input
