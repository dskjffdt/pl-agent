import { useEffect, useRef } from 'react'
import History from '../History/History'
import type { ChatRecord } from '../../api/type'

type ChatContentProps = {
    records: ChatRecord[]
    // 空状态建议问题点击后直接发送
    onSend: (text: string) => void
}

// 对话展示区：单一滚动容器，内容高度累加，吸底逻辑统一在此处理
export default function ChatContent({ records, onSend }: ChatContentProps) {
    const scrollRef = useRef<HTMLDivElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const stickRef = useRef(true)

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

    // 监听内部内容包装层高度变化：无论流式追加分片还是历史列表异步加载完成，
    // 内容撑高时触发回调，若用户在跟随底部则重新探底
    useEffect(() => {
        const scrollEl = scrollRef.current
        const contentEl = contentRef.current
        if (!scrollEl || !contentEl) return

        const observer = new ResizeObserver(() => {
            if (stickRef.current) scrollEl.scrollTop = scrollEl.scrollHeight
        })
        observer.observe(contentEl)

        return () => observer.disconnect()
    }, [])

    return (
        <div ref={scrollRef} className="thin-scrollbar h-full min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden [overflow-anchor:none]">
            <div ref={contentRef} className="mx-auto w-full max-w-[800px]">
                <History records={records} onSend={onSend} />
            </div>
        </div>
    )
}

// 判断是否已滚动到底部（留 2px 容差）
function isAtBottom(el: HTMLDivElement) {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= 2
}
