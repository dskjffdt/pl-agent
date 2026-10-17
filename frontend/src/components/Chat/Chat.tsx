import { useState } from 'react'
import Input from '../Input/Input'
import { selectEntry, stopStream, useChatStreams } from '../../stores/chat'

type ChatProps = {
    // 当前会话 id（null = 新会话）：用于订阅本会话流式态与停止流
    routeId: string | null
    onSend: (text: string) => void
}

export default function Chat({ routeId, onSend }: ChatProps) {
    const [input, setInput] = useState('')
    // 发送态只订阅布尔原始值：entry 每个 token flush 都会换引用，订整个对象会让输入区
    // 逐帧重渲；停止时用 getState 即时取 entry 即可
    const sending = useChatStreams((s) => selectEntry(s, routeId)?.streaming ?? false)

    function handleClick() {
        if (!input.trim() || sending) return
        onSend(input)
        setInput('')
    }

    function handleChangePrompt(e: React.ChangeEvent<HTMLTextAreaElement>) {
        setInput(e.target.value)
    }

    function handleStop() {
        if (routeId) stopStream(routeId)
    }

    return (
        <div className="shrink-0 pb-[8px]">
            <div className="mx-auto w-full max-w-[1000px]">
                <Input
                    prompt={input}
                    handleChangePrompt={handleChangePrompt}
                    handleClick={handleClick}
                    handleStop={handleStop}
                    sending={sending}
                />
            </div>
            <p className="pt-[8px] text-center text-xs text-gray-500">
                AI 生成内容仅供参考，请仔细甄别
            </p>
        </div>
    )
}
