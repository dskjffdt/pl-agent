// 空状态：居中问候语 + 建议问题，点击即发送
const SUGGESTIONS = [
    '现在几点了？',
    '距离 2027 年元旦还有多少天？',
    '写一句带今天日期的日记开头',
    '用 markdown 介绍一下你自己',
]

export default function EmptyState({ onSend }: { onSend: (text: string) => void }) {
    return (
        <div className="flex min-h-[65vh] flex-col items-center justify-center gap-6">
            <div className="flex flex-col items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-br from-blue-400 to-blue-600 shadow-xl shadow-blue-500/25">
                    <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
                        <path d="M21 12a8 8 0 0 1-8 8H4l2.5-3A8 8 0 1 1 21 12Z" />
                    </svg>
                </div>
                {/* 标题：灰→蓝渐变字 */}
                <h1 className="bg-gradient-to-r from-gray-900 via-gray-700 to-blue-600 bg-clip-text text-[clamp(22px,2.4vw,30px)] font-semibold text-transparent">
                    有什么可以帮你的？
                </h1>
            </div>
            <div className="flex max-w-[560px] flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((q) => (
                    <button
                        key={q}
                        onClick={() => onSend(q)}
                        className="rounded-full border border-gray-200 bg-white px-4 py-2 text-sm text-gray-600 transition-all hover:-translate-y-0.5 hover:border-blue-400 hover:text-blue-500 hover:shadow-sm"
                    >
                        {q}
                    </button>
                ))}
            </div>
        </div>
    )
}
