import { useState } from 'react'
import Input from '../Input/Input'

type ChatProps = {
    onSend: (text: string) => void
    sending: boolean
    onStop: () => void
    paused: boolean
    onTogglePause: () => void
}

export default function Chat({ onSend, sending, onStop, paused, onTogglePause }: ChatProps) {
    const [input, setInput] = useState('')

    function handleClick() {
        if (!input.trim() || sending) return
        onSend(input)
        setInput('')
    }

    function handleChangePrompt(e: React.ChangeEvent<HTMLTextAreaElement>) {
        setInput(e.target.value)
    }

    return (
        <div className="shrink-0 pb-[8px]">
            <div className="mx-auto w-full max-w-[800px]">
                <Input
                    prompt={input}
                    handleChangePrompt={handleChangePrompt}
                    handleClick={handleClick}
                    handleStop={onStop}
                    sending={sending}
                    paused={paused}
                    handleTogglePause={onTogglePause}
                />
            </div>
            <p className="pt-[8px] text-center text-xs text-gray-400">
                AI 生成内容仅供参考，请仔细甄别
            </p>
        </div>
    )
}
