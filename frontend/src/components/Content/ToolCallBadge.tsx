import type { ToolEvent } from '../../api/type'

// 单个工具调用状态胶囊：running 转圈 / done 勾 / error 叉
export default function ToolCallBadge({ event }: { event: ToolEvent }) {
    const { name, status } = event
    return (
        <div
            className={`inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1 text-[clamp(13px,1.3vw,15px)] ${
                status === 'error' ? 'text-red-500' : 'text-blue-600'
            }`}
        >
            <span className={status === 'running' ? 'inline-block animate-spin' : ''}>
                {status === 'running' ? '⟳' : status === 'error' ? '✕' : '✓'}
            </span>
            <span>
                {status === 'running'
                    ? `正在调用 ${name}…`
                    : status === 'error'
                        ? `${name} 调用失败`
                        : `已调用 ${name}`}
            </span>
        </div>
    )
}
