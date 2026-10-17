import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import type { ChatRecord } from '../../api/type'
import { isUserEntry } from '../../utils/records'
import CopyButton from './CopyButton'
import ToolCallBadge from './ToolCallBadge'

// Markdown 渲染库（stream-md）按需加载：拆出首屏 chunk，登录后由 App 预热，消息渲染零等待
const MarkdownBlock = lazy(() => import('./MarkdownBlock'))

type ConversationItemProps = {
    record: ChatRecord
    // 树节点 id（user 条目下即重试分支挂点；思考折叠的定位依据）
    nodeId: string
    // 父（user）节点 id：assistant 错误条内重试的分支挂点
    parentId: string | null
    // 会话流式中：禁止再次发起生成（防同会话并发流）
    busy: boolean
    // 重新生成：在指定 user 节点下开新分支（原回复保留）
    onRetry: (prompt: string, userNodeId: string) => void
    // user 节点专用：同一 prompt 下的回复版本分页（>1 时显示）
    versions?: string[]
    // 当前展示的回复版本节点 id（路径中紧邻该 user 的 assistant 子节点）
    currentVersionId?: string | null
    // 切换回复版本
    onSwitchVersion?: (assistantNodeId: string) => void
}

// 是否 user 节点条目的谓词见 utils/records（与组件文件分离，满足 fast-refresh 只导出组件）

// 同一 prompt 最多保留的回复版本数：达到后不再允许重新生成
const MAX_VERSIONS = 3

// 单条对话记录：用户输入（右对齐）+ 思考过程 + 回答
// React Compiler 自动 memo：历史条目 props 引用稳定时，流式期间不重渲
export default function ConversationItem({
    record,
    nodeId,
    parentId,
    busy,
    onRetry,
    versions,
    currentVersionId,
    onSwitchVersion,
}: ConversationItemProps) {
    // 流式态 = pending（等待首字）或 streaming（有输出中）
    const streaming = record.status === 'pending' || record.status === 'streaming'
    // 等待首字：已发送但还没有任何输出（思考/回答/工具都未开始）
    const waiting = record.status === 'pending'

    // 同一 prompt 的回复版本已达上限（3 个）则禁止再开重试分支
    const canRetryVersion = (versions?.length ?? 0) < MAX_VERSIONS

    // 思考过程折叠态：纯本条目 UI 状态，无外部读者，收敛在组件内部（流式中强制展开）
    const [collapsed, setCollapsed] = useState(false)
    const expanded = streaming || !collapsed

    // 用户气泡的「点击改 prompt 后重新生成」内联编辑（readonly textarea 切换）
    const [editing, setEditing] = useState(false)
    const [draft, setDraft] = useState(record.prompt)
    const editRef = useRef<HTMLTextAreaElement>(null)

    // 编辑态 textarea 高度随内容增长（宽度交给 CSS：编辑态 w-full；只读态用 div 内容包裹）
    const growHeight = (el: HTMLTextAreaElement) => {
        el.style.height = 'auto'
        el.style.height = `${el.scrollHeight}px`
    }

    // 视口缩放导致 w-full 宽度变化时，编辑框折行数变化，高度需重测（只读 div 纯 CSS 自适应）
    useEffect(() => {
        const onResize = () => {
            const el = editRef.current
            if (el) growHeight(el)
        }
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
    }, [])

    // 进入编辑：textarea 刚挂载，测初始高度 + 聚焦，光标置末尾。
    // 只依赖 editing 跳变，不能依赖 draft——否则打字时光标会被反复拽到末尾
    useEffect(() => {
        if (!editing) return
        const el = editRef.current
        if (!el) return
        growHeight(el)
        el.focus()
        el.setSelectionRange(el.value.length, el.value.length)
    }, [editing])

    const startEdit = () => {
        if (busy || !canRetryVersion) return
        setDraft(record.prompt)
        setEditing(true)
    }

    const cancelEdit = () => {
        setDraft(record.prompt)
        setEditing(false)
    }

    const confirmEdit = () => {
        const text = draft.trim()
        // 空内容不发起：保留编辑态让用户继续改
        if (!text) return
        setEditing(false)
        onRetry(text, nodeId)
    }

    // user 节点条目：编辑按钮进编辑态，可改 prompt 后确认重开分支；气泡本身不可点
    if (isUserEntry(record)) {
        return (
            <div className="flex w-full flex-col items-end gap-1">
                <div className="flex w-full justify-end">
                    {editing ? (
                        // 编辑态：textarea 占满整行（CSS w-full），仅高度随内容增长
                        <textarea
                            ref={editRef}
                            rows={1}
                            value={draft}
                            autoFocus
                            onChange={(e) => {
                                setDraft(e.target.value)
                                growHeight(e.target)
                            }}
                            onKeyDown={(e) => {
                                // Enter 确认（Shift+Enter 换行），Esc 取消
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault()
                                    confirmEdit()
                                } else if (e.key === 'Escape') {
                                    e.preventDefault()
                                    cancelEdit()
                                }
                            }}
                            className="min-h-[120px] w-full resize-none overflow-hidden whitespace-pre-wrap rounded-2xl bg-white px-4 py-2 text-left text-[clamp(17px,1.7vw,20px)] text-gray-900 shadow-sm ring-2 ring-blue-400 focus:outline-none"
                        />
                    ) : (
                        // 只读态：普通 div 即可——inline 流布局天然按内容收缩，
                        // max-width 750px 封顶折行；窄屏 min(...,100%) 兜底。文字仍可选中复制
                        <div className="max-w-[min(750px,100%)] select-text whitespace-pre-wrap break-words rounded-2xl bg-blue-50 px-4 py-2 text-left text-[clamp(17px,1.7vw,20px)] text-gray-900">
                            {record.prompt}
                        </div>
                    )}
                </div>
                {/* 操作行（右对齐）：常态为编辑按钮；编辑态为取消 / 确认 */}
                <div className="flex items-center gap-2 pr-1">
                    {!editing && !busy && (
                        <button
                            type="button"
                            onClick={startEdit}
                            disabled={!canRetryVersion}
                            title={canRetryVersion ? '修改并重新生成' : `最多重新生成 ${MAX_VERSIONS} 个回复版本`}
                            className="flex h-8 w-8 items-center justify-center rounded-full text-gray-400 transition-colors enabled:hover:bg-gray-100 enabled:hover:text-blue-500 disabled:cursor-not-allowed disabled:opacity-30"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                                <path d="M12 20h9" />
                                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                            </svg>
                        </button>
                    )}
                    {editing && (
                        <>
                            <button
                                type="button"
                                onClick={cancelEdit}
                                title="取消（Esc）"
                                className="rounded-full border border-gray-200 bg-white px-5 py-2 text-base text-gray-600 transition-colors hover:bg-gray-100"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={confirmEdit}
                                disabled={draft.trim().length === 0}
                                title="确认重新生成（Enter）"
                                className="rounded-full bg-blue-500 px-5 py-2 text-base text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:bg-gray-300"
                            >
                                确定
                            </button>
                        </>
                    )}
                </div>
                {/* 回复版本分页：同一 prompt 下存在多个版本时显示在气泡下方 */}
                {versions && versions.length > 1 && currentVersionId != null && (() => {
                    const idx = versions.indexOf(currentVersionId)
                    if (idx < 0) return null
                    const arrowCls =
                        'flex h-11 w-11 items-center justify-center rounded-full text-gray-500 transition-colors enabled:hover:bg-gray-100 enabled:hover:text-blue-500 disabled:cursor-not-allowed disabled:opacity-30'
                    const switchTo = (id: string | undefined) => {
                        if (id && !busy) onSwitchVersion?.(id)
                    }
                    return (
                        <div className="flex items-center gap-2 pr-1 text-lg text-gray-600">
                            <button
                                type="button"
                                disabled={busy || idx === 0}
                                onClick={() => switchTo(versions[idx - 1])}
                                title="上一个回复版本"
                                className={arrowCls}
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                                    <path d="m15 18-6-6 6-6" />
                                </svg>
                            </button>
                            <span className="min-w-[3.2rem] text-center tabular-nums">
                                {idx + 1}/{versions.length}
                            </span>
                            <button
                                type="button"
                                disabled={busy || idx === versions.length - 1}
                                onClick={() => switchTo(versions[idx + 1])}
                                title="下一个回复版本"
                                className={arrowCls}
                            >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                                    <path d="m9 18 6-6-6-6" />
                                </svg>
                            </button>
                        </div>
                    )
                })()}
            </div>
        )
    }

    return (
        <div className="group flex w-full flex-col">
            {/* 思考过程标题行：流式中为静态标签，结束后为折叠按钮 */}
            <div className="mt-1 flex w-full items-center gap-1 text-[clamp(14px,1.4vw,17px)] text-gray-500">
                {streaming ? (
                    <span>思考过程:</span>
                ) : (
                    <button
                        onClick={() => setCollapsed((v) => !v)}
                        className="flex w-full items-center gap-1 rounded-lg py-0.5 text-left transition-colors hover:bg-blue-50 hover:text-blue-500"
                    >
                        <span>{expanded ? '▾' : '▸'}</span>
                        <span>思考过程</span>
                    </button>
                )}
                {/* 等待首字期间显示三点跳动，消除"发送后无反应"的错觉 */}
                {streaming && waiting && (
                    <span className="inline-flex items-center gap-1 align-middle">
                        <span className="thinking-dot" />
                        <span className="thinking-dot" />
                        <span className="thinking-dot" />
                    </span>
                )}
            </div>
            {/* 思考过程内容：流式中或结束后展开时显示
                MarkdownBlock 始终处于同一 React 位置，streaming 切换不卸载实例、避免 StreamMD 全量重解析闪烁 */}
            {(streaming || expanded) && (
                <div className="mt-1 rounded-r-lg border-l-2 border-gray-200 bg-gray-50/60 px-3 py-1.5">
                    <div className="markdown-body text-[clamp(14px,1.4vw,17px)] text-gray-500">
                        {record.reasoning && (
                            <Suspense fallback={null}>
                                <MarkdownBlock text={record.reasoning} streaming={streaming} />
                            </Suspense>
                        )}
                    </div>
                </div>
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
                className="markdown-body mt-2 w-full border-l-2 border-blue-100 pl-3 text-[clamp(17px,1.7vw,20px)] text-gray-900"
            >
                {record.content && (
                    <Suspense fallback={null}>
                        <MarkdownBlock text={record.content} streaming={streaming} />
                    </Suspense>
                )}
            </div>
            {/* 复制整条回答（hover 出现，流式结束后可用）；重新生成入口在用户气泡上 */}
            {!streaming && record.content.length > 0 && (
                <div className="mt-1 flex items-center gap-2">
                    <CopyButton
                        getText={() => record.content}
                        className="self-start text-gray-500 transition-colors hover:text-blue-500"
                    />
                </div>
            )}
            {/* 请求失败提示 + 重试入口（异常就地恢复，挂点为该回复的 user 父节点） */}
            {record.error && (
                <div className="mt-2 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-[clamp(13px,1.3vw,15px)] text-red-600">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="mt-1 h-3.5 w-3.5 shrink-0">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M12 7v6" />
                        <path d="M12 16.5v.5" />
                    </svg>
                    <span className="flex-1">{record.error}</span>
                    {parentId && (
                        <button
                            onClick={() => onRetry(record.prompt, parentId)}
                            disabled={busy || !canRetryVersion}
                            title={canRetryVersion ? undefined : `最多重新生成 ${MAX_VERSIONS} 个回复版本`}
                            className="shrink-0 self-center rounded-md px-2 py-1 font-medium transition-colors enabled:hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            重试
                        </button>
                    )}
                </div>
            )}
        </div>
    )
}