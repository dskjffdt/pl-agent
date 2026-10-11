import { useEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { ChatRecord } from '../api/type'
import { BlockAccumulator } from '../utils/blocks'
import { updateLastRecord } from '../utils/records'
import { closeSyntax } from '../utils/markdown'

const CHARS_PER_FRAME_REASONING = 6
const CHARS_PER_FRAME_CONTENT = 6

// 打字机引擎：SSE 文本先进原始缓冲，RAF 每帧取固定字符数逐字揭示，
// 累积器攒满一个块就密封追加，残余部分挂在最后一条记录的 growing 上
export function useTypewriter(
    setRecords: Dispatch<SetStateAction<ChatRecord[]>>,
    // 打字机全部追完（缓冲 + 累积器都空）时回调，用于关闭发送中状态
    onDone: () => void,
) {
    // 待编码成块的缓冲区（reasoning / content 分开缓冲）
    const bufferRef = useRef<{ reasoning: string; content: string }>({ reasoning: '', content: '' })
    // BlockAccumulator 实例（ref，不触发渲染）
    const accRef = useRef<{ reasoning: BlockAccumulator; content: BlockAccumulator }>({
        reasoning: new BlockAccumulator(),
        content: new BlockAccumulator(),
    })
    // 流是否已结束
    const streamDoneRef = useRef(false)
    // RAF 句柄：null 表示未在跑
    const rafRef = useRef<number | null>(null)
    // tick 函数引用：每次 render 更新，让 RAF 永远调用最新闭包
    const tickRef = useRef<() => void>(() => {})

    // 组件卸载时停止 RAF，避免循环在卸载后空转并触发无效 setState
    useEffect(() => {
        return () => {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
        }
    }, [])

    // 启动打字机 RAF（如果还没在跑）
    function startTyping() {
        if (rafRef.current !== null) return
        const loop = () => {
            rafRef.current = requestAnimationFrame(loop)
            tickRef.current()
        }
        rafRef.current = requestAnimationFrame(loop)
    }

    // tick 逻辑：从缓冲区中取固定字符数，push 进累积器，块产出直接追加到 records
    tickRef.current = () => {
        const buffer = bufferRef.current
        const acc = accRef.current

        // reasoning 原始 buffer 空了但 acc 还有残留 → 提前 flush 残留
        // flush 后 acc 自然空了，不会重复触发，无需 flag
        if (buffer.reasoning === '' && acc.reasoning.getBuffer() !== '') {
            const rFlush = acc.reasoning.flush()
            if (rFlush.length) {
                updateLastRecord(setRecords, (last) => {
                    last.reasoning = [...last.reasoning, ...rFlush]
                    last.growing = last.growing ? { reasoning: '', content: last.growing.content } : undefined
                })
                // flush 后 acc 空，直接继续处理 content（不 return）
            }
        }

        // 串行揭示：reasoning 原始 buffer 空了且 acc 也空了，才开始取 content
        const reasoningIdle = buffer.reasoning === '' && acc.reasoning.getBuffer() === ''

        // 全部空且流已结束：flush 累积器，关闭 RAF，标记非流式
        if (buffer.reasoning === '' && buffer.content === '' && streamDoneRef.current) {
            const cFlush = acc.content.flush()
            streamDoneRef.current = false
            onDone()
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current)
                rafRef.current = null
            }
            updateLastRecord(setRecords, (last) => {
                if (cFlush.length) last.content = [...last.content, ...cFlush]
                last.streaming = false
                last.growing = undefined
            })
            return
        }

        // 缓冲为空且流未结束，继续等待
        if (
            buffer.reasoning === '' &&
            buffer.content === '' &&
            acc.reasoning.getBuffer() === '' &&
            acc.content.getBuffer() === ''
        ) {
            return
        }

        // 从缓冲区取固定字符数
        let rChunk = ''
        let cChunk = ''

        if (buffer.reasoning.length > 0) {
            const take = Math.min(CHARS_PER_FRAME_REASONING, buffer.reasoning.length)
            rChunk = buffer.reasoning.slice(0, take)
            bufferRef.current.reasoning = buffer.reasoning.slice(take)
        }

        if (reasoningIdle && buffer.content.length > 0) {
            const take = Math.min(CHARS_PER_FRAME_CONTENT, buffer.content.length)
            cChunk = buffer.content.slice(0, take)
            bufferRef.current.content = buffer.content.slice(take)
        }

        // push 进累积器，产出的完整块直接追加到 records
        const rBlocks = rChunk ? acc.reasoning.push(rChunk) : []
        const cBlocks = cChunk ? acc.content.push(cChunk) : []

        // 没有新数据且没有新块：跳过 setRecords，避免无意义渲染
        if (!rChunk && !cChunk && !rBlocks.length && !cBlocks.length) return

        updateLastRecord(setRecords, (last) => {
            if (rBlocks.length) {
                last.reasoning = [...last.reasoning, ...rBlocks]
            }
            if (cBlocks.length) {
                last.content = [...last.content, ...cBlocks]
            }
            last.growing = {
                reasoning: closeSyntax(acc.reasoning.getBuffer()),
                content: closeSyntax(acc.content.getBuffer()),
            }
        })
    }

    // SSE 收到新文本：入队并启动 RAF（空文本直接忽略）
    function enqueue(reasoning: string, content: string) {
        if (!reasoning && !content) return
        bufferRef.current.reasoning += reasoning
        bufferRef.current.content += content
        startTyping()
    }

    // 新一轮对话：重置缓冲与累积器
    function reset() {
        bufferRef.current = { reasoning: '', content: '' }
        accRef.current = { reasoning: new BlockAccumulator(), content: new BlockAccumulator() }
        streamDoneRef.current = false
    }

    // 流结束：标记后 RAF 会在处理完缓冲后自动收尾
    function finish() {
        streamDoneRef.current = true
        startTyping()
    }

    // 停止生成：取消 RAF，清空缓冲，把残余文本密封成块保留（已生成的部分不丢）
    function stop() {
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current)
            rafRef.current = null
        }
        streamDoneRef.current = false
        const buffer = bufferRef.current
        const acc = accRef.current
        bufferRef.current = { reasoning: '', content: '' }
        updateLastRecord(setRecords, (last) => {
            // flush 覆盖累积器残余（growing 就是它的快照，置空即可，不能重复追加）
            const rFlush = [...acc.reasoning.flush(), ...(buffer.reasoning ? [closeSyntax(buffer.reasoning)] : [])]
            const cFlush = [...acc.content.flush(), ...(buffer.content ? [closeSyntax(buffer.content)] : [])]
            if (rFlush.length) last.reasoning = [...last.reasoning, ...rFlush]
            if (cFlush.length) last.content = [...last.content, ...cFlush]
            last.growing = undefined
            last.streaming = false
        })
    }

    return { reset, enqueue, finish, stop }
}
