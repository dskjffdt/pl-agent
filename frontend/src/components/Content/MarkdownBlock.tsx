import { StreamMD } from 'stream-md'
import 'stream-md/styles.css'

// React Compiler 自动 memo：text 引用不变则跳过重渲
export default function MarkdownBlock({ text }: { text: string; streaming?: boolean }) {
    return <StreamMD text={text} theme="light" showCursor={false} />
}
