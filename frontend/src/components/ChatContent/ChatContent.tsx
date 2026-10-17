import { useEffect, useLayoutEffect, useRef } from 'react'
import History from '../History/History'
import EmptyState from '../History/EmptyState'
import { buildPath, selectEntry, switchBranch, useChatStreams } from '../../stores/chat'

type ChatContentProps = {
    // 当前会话 id（null = 新会话）：对话记录按会话从流式 store 订阅
    routeId: string | null
    // 空状态建议问题点击后直接发送
    onSend: (text: string) => void
    // 重试：点击用户气泡触发，在指定 user 节点下开新分支
    onRetry: (prompt: string, userNodeId: string) => void
    // 向上加载更多（滚动到顶部时触发）；返回是否真正插入了新内容（失败/无更多时调用方复位加载态）
    onLoadMore: () => Promise<boolean>
}

// 对话展示区：单一滚动容器，内容高度累加，吸底逻辑统一在此处理
export default function ChatContent({ routeId, onSend, onRetry, onLoadMore }: ChatContentProps) {
    // selector 只订阅 entry 引用：其他会话 flush 时它身份不变（map 只替换目标 entry）。
    // 路径投影在渲染体调用——React Compiler 按 entry 引用自动缓存数组（等价 useMemo）；
    // 但绝不能把 buildPath 挪进 selector：useSyncExternalStore 取快照每次得到新数组
    // 会触发 snapshot 不一致保护，导致无限重渲（React #185）
    const entry = useChatStreams((s) => selectEntry(s, routeId))
    const items = buildPath(entry)
    const scrollRef = useRef<HTMLDivElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const stickRef = useRef(true)
    // 向上加载更多状态：防止重复触发
    const loadingMoreRef = useRef(false)
    // 待补偿的滚动锚点：loadMore 触发时记录，prepend 渲染完成后由 useLayoutEffect 消费
    const pendingAnchorRef = useRef<{ scrollTop: number; scrollHeight: number } | null>(null)

    // 分支切换：仅替换 prompt 下方的版本节点（上方 DOM 复用，scrollTop 不动则气泡位置不变）。
    // 语义等同用户主动离开底部：stick 置 false，内容替换及后续 markdown 异步撑高都不触发吸底；
    // 用户手动滚回底部（wheel 判定）或发送新消息时才恢复跟随
    const handleSwitchBranch = (nodeId: string) => {
        stickRef.current = false
        switchBranch(routeId, nodeId)
    }

    // 发送 / 重试都会产生新内容：恢复跟随底部，让 ResizeObserver 把新回复带入视口
    const handleSend = (text: string) => {
        stickRef.current = true
        onSend(text)
    }
    const handleRetry = (prompt: string, userNodeId: string) => {
        stickRef.current = true
        onRetry(prompt, userNodeId)
    }

    // 只凭 scroll 事件判断会误伤：程序化设 scrollTop 后事件异步派发，
    // 等它执行时新分片可能已追加、scrollHeight 变大而 scrollTop 还是旧值，
    // 会被误判成「用户上滚」。所以只在真实用户手势时才更新跟随状态。
    useEffect(() => {
        const el = scrollRef.current
        if (!el) return

        const onWheel = (e: WheelEvent) => {
            stickRef.current = e.deltaY < 0 ? false : isAtBottom(el)
        }
        const onTouchEnd = () => {
            stickRef.current = isAtBottom(el)
        }

        el.addEventListener('wheel', onWheel, { passive: true })
        el.addEventListener('touchmove', onTouchEnd, { passive: true })
        el.addEventListener('touchend', onTouchEnd, { passive: true })
        return () => {
            el.removeEventListener('wheel', onWheel)
            el.removeEventListener('touchmove', onTouchEnd)
            el.removeEventListener('touchend', onTouchEnd)
        }
    }, [])

    // 滚动到顶部时加载更多历史消息。锚点补偿不在此处做——onLoadMore resolve 时
    // React 可能还没把新节点 flush 到 DOM，量不到新高度；改由下方 useLayoutEffect 消费
    useEffect(() => {
        const el = scrollRef.current
        if (!el) return

        const onScroll = () => {
            // 流式期间不触发加载（避免与 rAF 合批冲突）
            if (entry?.streaming) return
            // 无更多消息、正在加载、或上一次加载的异步内容（MarkdownBlock chunk）未稳定时跳过
            if (!entry?.hasMore || loadingMoreRef.current || pendingAnchorRef.current) return
            // 滚动到顶部阈值（100px）
            if (el.scrollTop > 100) return

            loadingMoreRef.current = true
            // 翻历史 = 用户不在底部：禁用吸底。否则 prepend 后 contentRef 变高触发
            // ResizeObserver，若 stickRef 仍为 true（拖滚动条/键盘上来的，没走过 wheel
            // 判定）会把 scrollTop 拽到最底部，覆盖锚点补偿——即「往下弹」的根因
            stickRef.current = false
            // 记录锚点：加载前的高度和位置
            pendingAnchorRef.current = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight }

            void onLoadMore().then((inserted) => {
                // 失败或无新内容时 items 不变，useLayoutEffect 不会消费锚点，这里兜底复位
                if (!inserted) {
                    pendingAnchorRef.current = null
                    loadingMoreRef.current = false
                }
            })
        }

        el.addEventListener('scroll', onScroll, { passive: true })
        return () => el.removeEventListener('scroll', onScroll)
    }, [entry?.streaming, entry?.hasMore, onLoadMore])

    // prepend 渲染完成（items 变化）后、paint 前同步补偿滚动位置：
    // 新内容把列表顶高了多少，scrollTop 就补多少，用户正在看的消息视觉位置不动。
    // 但 MarkdownBlock 是 lazy chunk，首次渲染时 fallback 高度 ≠ 真实高度，
    // 所以这里只先补一次；后续高度变化由 ResizeObserver 持续校正直到稳定。
    useLayoutEffect(() => {
        const pending = pendingAnchorRef.current
        const el = scrollRef.current
        if (!pending || !el) return
        el.scrollTop = pending.scrollTop + (el.scrollHeight - pending.scrollHeight)
        loadingMoreRef.current = false
        // 保留 pendingAnchorRef：等 MarkdownBlock 加载完成、高度稳定后由 ResizeObserver 清除
    }, [items])

    // 监听内部内容包装层高度变化：流式追加、历史消息异步加载完成都会撑高内容。
    // 若用户在跟随底部则重新探底；若有未完成的锚点补偿（MarkdownBlock 等异步内容
    // 陆续撑高），持续校正直到高度稳定 150ms 后清除锚点。
    useEffect(() => {
        const scrollEl = scrollRef.current
        const contentEl = contentRef.current
        if (!scrollEl || !contentEl) return

        let stableTimer: number | null = null

        const observer = new ResizeObserver(() => {
            const pending = pendingAnchorRef.current
            if (pending) {
                // 历史消息的 MarkdownBlock 等异步内容陆续撑高，持续校正
                scrollEl.scrollTop = pending.scrollTop + (scrollEl.scrollHeight - pending.scrollHeight)
                // 等高度稳定 150ms 后清除锚点，完成加载
                if (stableTimer) clearTimeout(stableTimer)
                stableTimer = window.setTimeout(() => {
                    pendingAnchorRef.current = null
                }, 150)
                return
            }
            if (stickRef.current) scrollEl.scrollTop = scrollEl.scrollHeight
        })
        observer.observe(contentEl)

        return () => {
            observer.disconnect()
            if (stableTimer) clearTimeout(stableTimer)
        }
    }, [])

    // 切换会话：内容整体替换，主动跳底并重置跟随态。
    // 注意依赖只有 routeId——切换回复版本（leafId 变）不能进这里，否则会强制吸底
    useEffect(() => {
        const el = scrollRef.current
        if (!el) return
        stickRef.current = true
        el.scrollTop = el.scrollHeight
    }, [routeId])

    return (
        <div ref={scrollRef} className="thin-scrollbar h-full min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden [overflow-anchor:none] [scrollbar-gutter:stable]">
            {/* role=log 隐含 aria-live=polite，屏幕阅读器在空闲时朗读新增内容；
                aria-relevant=additions 只朗读追加的节点，不重读整个列表（流式 token 级更新场景必须） */}
            <div ref={contentRef} role="log" aria-relevant="additions" className="mx-auto w-full max-w-[1000px]">
                {items.length === 0 ? (
                    <EmptyState onSend={handleSend} />
                ) : (
                    <History items={items} busy={entry?.streaming ?? false} onRetry={handleRetry} onSwitchBranch={handleSwitchBranch} />
                )}
            </div>
        </div>
    )
}

// 判断是否已滚动到底部（留 2px 容差）
function isAtBottom(el: HTMLDivElement) {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= 2
}
