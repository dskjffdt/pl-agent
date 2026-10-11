import { useState } from 'react'
import { copyText } from '../../utils/clipboard'

type CopyButtonProps = {
    // 点击时取要复制的文本（延迟求值，代码块通过 ref 读取当时的 DOM 内容）
    getText: () => string
    className?: string
}

// 复制按钮：复制图标，成功后短暂切换为对勾
export default function CopyButton({ getText, className }: CopyButtonProps) {
    const [copied, setCopied] = useState(false)

    function handleCopy() {
        void copyText(getText()).then((ok) => {
            if (!ok) return
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
        })
    }

    return (
        <button onClick={handleCopy} title="复制" className={className}>
            {copied ? (
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3.5 w-3.5 text-green-500"
                >
                    <path d="M20 6 9 17l-5-5" />
                </svg>
            ) : (
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3.5 w-3.5"
                >
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
            )}
        </button>
    )
}
