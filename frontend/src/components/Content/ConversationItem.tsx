import { memo } from 'react'
import type { ChatRecord } from '../../api/type'
import CopyButton from './CopyButton'
import MarkdownBlock from './MarkdownBlock'
import ToolCallBadge from './ToolCallBadge'

type ConversationItemProps = {
    record: ChatRecord
    // 思考过程是否展开（流式中强制展开）
    expanded: boolean
    onToggle: (id: string) => void
}

// 单条对话记录：用户输入（右对齐）+ 思考过程 + 回答
// 整条 memo：历史条目的 record/expanded/onToggle 引用稳定，流式期间不重渲
// 流式中的记录额外渲染 growing（打字机正在逐字生长的未完成文本）
export default memo(function ConversationItem({ record, expanded, onToggle }: ConversationItemProps) {
    const streaming = record.streaming === true
    const growingReasoning = record.growing?.reasoning ?? ''
    const growingContent = record.growing?.content ?? ''
    // 等待首字：已发送但模型还没有任何输出（思考/回答/工具都未开始）
    const waiting = streaming && record.reasoning.length === 0 && record.content.length === 0 && !record.toolEvents?.length

    return (
        <div className="flex w-full flex-col">
            {/* 用户输入：右对齐浅色气泡 */}
            <div className="flex w-full justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-blue-50 px-4 py-2 text-[clamp(17px,1.7vw,20px)] text-gray-900">
                    {record.prompt}
                </div>
            </div>
            {/* 思考过程：流式中直接展示，结束后可折叠 */}
            {streaming ? (
                <div className="w-full">
                    <span className="text-[clamp(14px,1.4vw,17px)] text-gray-400">思考过程:</span>
                    {/* 等待首字期间显示三点跳动，消除"发送后无反应"的错觉 */}
                    {waiting && (
                        <span className="ml-2 inline-flex items-center gap-1 align-middle">
                            <span className="thinking-dot" />
                            <span className="thinking-dot" />
                            <span className="thinking-dot" />
                        </span>
                    )}
                    <div
                        className={`markdown-body text-[clamp(14px,1.4vw,17px)] text-gray-400 ${
                            growingReasoning ? 'typing' : ''
                        }`}
                    >
                        {record.reasoning.map((chunk, i) => (
                            <MarkdownBlock key={i} text={chunk} />
                        ))}
                        {growingReasoning && <MarkdownBlock text={growingReasoning} />}
                    </div>
                </div>
            ) : (
                <>
                    <button
                        onClick={() => onToggle(record.id)}
                        className="mt-1 flex w-full items-center gap-1 rounded-lg py-0.5 text-left text-[clamp(14px,1.4vw,17px)] text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-500"
                    >
                        <span>{expanded ? '▾' : '▸'}</span>
                        <span>思考过程</span>
                    </button>
                    {expanded && (
                        <div className="mt-1 markdown-body text-[clamp(14px,1.4vw,17px)] text-gray-400">
                            {record.reasoning.map((chunk, i) => (
                                <MarkdownBlock key={i} text={chunk} />
                            ))}
                        </div>
                    )}
                </>
            )}
            {/* 工具调用状态胶囊（思考过程与回答之间，按发生顺序） */}
            {record.toolEvents && record.toolEvents.length > 0 && (
                <div className="mt-1.5 flex flex-col items-start gap-1.5">
                    {record.toolEvents.map((t) => (
                        <ToolCallBadge key={t.id} event={t} />
                    ))}
                </div>
            )}
            {/* AI 回答 */}
            <div
                className={`markdown-body mt-2 w-full text-[clamp(17px,1.7vw,20px)] text-gray-900 ${
                    streaming ? 'typing' : ''
                }`}
            >
                {record.content.map((chunk, i) => (
                    <MarkdownBlock key={i} text={chunk} />
                ))}
                {growingContent && <MarkdownBlock text={growingContent} />}
            </div>
            {/* 复制整条回答（流式结束后出现） */}
            {!streaming && record.content.length > 0 && (
                <CopyButton
                    getText={() => record.content.join('')}
                    className="mt-1 self-start text-gray-400 transition-colors hover:text-blue-500"
                />
            )}
            {/* 请求失败提示 */}
            {record.error && (
                <div className="mt-2 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-[clamp(13px,1.3vw,15px)] text-red-500">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mt-1 h-3.5 w-3.5 shrink-0">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v6" />
                        <path d="M12 16.5v.5" />
                    </svg>
                    <span>{record.error}</span>
                </div>
            )}
            {/* 违禁内容拦截提示（输入命中不落库，输出命中截断后仍显示已生成的安全部分） */}
            {record.filtered && (
                <div className="mt-2 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-[clamp(13px,1.3vw,15px)] text-amber-600">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-1 h-3.5 w-3.5 shrink-0">
                        <path d="M12 3 2.5 20h19L12 3Z" />
                        <path d="M12 10v4" />
                        <path d="M12 17.5v.5" />
                    </svg>
                    <span>内容包含违禁信息，已被安全过滤拦截</span>
                </div>
            )}
        </div>
    )
})
