import { Suspense, lazy } from 'react'

// react-markdown 全家桶（unified/remark 生态，体积大头）按需加载：
// 空会话首屏（侧栏 + 输入框 + 欢迎语）完全用不到 markdown 渲染器，
// 首条消息出现时才拉取对应 chunk——弱网下首屏 JS 显著减小，LCP 提前
const Impl = lazy(() => import('./MarkdownBlockImpl'))

export default function MarkdownBlock({ text }: { text: string }) {
    return (
        // chunk 下载期间降级为纯文本：流式揭示语义不变，chunk 到位后升级为完整 markdown 渲染
        <Suspense fallback={<span>{text}</span>}>
            <Impl text={text} />
        </Suspense>
    )
}
