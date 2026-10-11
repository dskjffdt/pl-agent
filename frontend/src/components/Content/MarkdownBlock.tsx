import { memo, useRef } from 'react'
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import CopyButton from './CopyButton'

// 模块级常量，避免每次 render 创建新数组/对象触发 ReactMarkdown 重新初始化
const remarkPlugins = [remarkGfm]

// 代码块：右上角复制按钮（按钮在 pre 外层，不污染 pre 的 textContent）
function CodeBlock({ children }: { children?: ReactNode }) {
    const preRef = useRef<HTMLPreElement>(null)
    return (
        <div className="group relative">
            <CopyButton
                getText={() => preRef.current?.textContent ?? ''}
                className="absolute right-2 top-2 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-blue-500"
            />
            <pre ref={preRef}>{children}</pre>
        </div>
    )
}

const components = { pre: CodeBlock }

// 单块渲染：text 不变则跳过重渲，避免已完成块每帧重新解析 markdown
export default memo(function MarkdownBlock({ text }: { text: string }) {
    return (
        <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
            {text}
        </ReactMarkdown>
    )
})
