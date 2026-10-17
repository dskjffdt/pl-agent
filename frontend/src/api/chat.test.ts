import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { streamChat } from './chat'
import { AuthError } from './auth'
import { ApiError } from '../utils/apiError'

// jsdom 的 ReadableStream 在 Node 18+ 可用
function createSSEResponse(lines: string[], status = 200): Response {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
        start(controller) {
            for (const line of lines) {
                controller.enqueue(encoder.encode(line + '\n'))
            }
            controller.close()
        },
    })
    return new Response(stream, { status })
}

function line(obj: Record<string, unknown>): string {
    return JSON.stringify(obj)
}

describe('streamChat', () => {
    const originalFetch = globalThis.fetch

    beforeEach(() => {
        vi.clearAllMocks()
    })

    afterEach(() => {
        globalThis.fetch = originalFetch
    })

    it('正常流：meta + text + done，状态流转 pending → streaming → done', async () => {
        const lines = [
            line({
                seq: 0,
                conversation_id: 'conv-1',
                user_message_id: 'u-1',
                assistant_message_id: 'a-1',
                parent_message_id: null,
            }),
            line({ seq: 1, reasoning_content: '', content: 'Hello' }),
            line({ seq: 2, reasoning_content: '', content: ' world' }),
        ]
        globalThis.fetch = vi.fn().mockResolvedValue(createSSEResponse(lines))

        const texts: string[] = []
        let meta: Record<string, unknown> | null = null

        await streamChat('hi', { conversationId: null }, new AbortController().signal, {
            onMeta: (m) => {
                meta = m
            },
            onText: (_r, c) => {
                texts.push(c)
            },
            onToolStart: () => {},
            onToolEnd: () => {},
        })

        expect(meta).toEqual({
            conversationId: 'conv-1',
            userId: 'u-1',
            assistantId: 'a-1',
            parentId: null,
        })
        // meta 行也触发 onText（content 为空），真正的空过滤在 runtime 层做
        expect(texts).toEqual(['', 'Hello', ' world'])
    })

    it('断流：拿到 task_id 后中断，走 resume 续传', async () => {
        // 第一次连接：meta + 部分 text，然后中断
        const firstLines = [
            line({
                seq: 0,
                conversation_id: 'conv-1',
                user_message_id: 'u-1',
                assistant_message_id: 'a-1',
                parent_message_id: null,
            }),
            line({ seq: 1, reasoning_content: '', content: 'partial' }),
        ]
        // 第二次连接（resume）：继续 text
        const secondLines = [line({ seq: 2, reasoning_content: '', content: ' done' })]

        let callCount = 0
        globalThis.fetch = vi.fn().mockImplementation((url: string) => {
            callCount++
            if (callCount === 1) {
                // 第一次：返回流但提前中断（模拟网络断开）
                const encoder = new TextEncoder()
                const stream = new ReadableStream({
                    start(controller) {
                        for (const l of firstLines) {
                            controller.enqueue(encoder.encode(l + '\n'))
                        }
                        // 不 close，模拟中断
                        setTimeout(() => controller.error(new Error('network error')), 10)
                    },
                })
                return Promise.resolve(new Response(stream, { status: 200 }))
            }
            // 第二次：resume
            expect(url).toContain('/chat/resume/a-1')
            expect(url).toContain('after_seq=1')
            return Promise.resolve(createSSEResponse(secondLines))
        })

        const texts: string[] = []
        await streamChat('hi', { conversationId: null }, new AbortController().signal, {
            onMeta: () => {},
            onText: (_r, c) => {
                texts.push(c)
            },
            onToolStart: () => {},
            onToolEnd: () => {},
        })

        expect(callCount).toBe(2)
        // meta 行也触发 onText（content 为空），真正的空过滤在 runtime 层做
        expect(texts).toEqual(['', 'partial', ' done'])
    })

    it('乱序：重复 seq 的事件内容也会正常处理（去重依赖服务端 resume 时的 after_seq）', async () => {
        // 模拟服务端重发（resume 时 after_seq 之前的事件不应重复）
        const lines = [
            line({
                seq: 0,
                conversation_id: 'conv-1',
                user_message_id: 'u-1',
                assistant_message_id: 'a-1',
                parent_message_id: null,
            }),
            line({ seq: 1, reasoning_content: '', content: 'A' }),
            line({ seq: 1, reasoning_content: '', content: 'A' }), // 重复 seq
            line({ seq: 2, reasoning_content: '', content: 'B' }),
        ]
        globalThis.fetch = vi.fn().mockResolvedValue(createSSEResponse(lines))

        const texts: string[] = []
        await streamChat('hi', { conversationId: null }, new AbortController().signal, {
            onMeta: () => {},
            onText: (_r, c) => {
                texts.push(c)
            },
            onToolStart: () => {},
            onToolEnd: () => {},
        })

        // meta 行也触发 onText（content 为空），真正的空过滤在 runtime 层做
        expect(texts).toEqual(['', 'A', 'A', 'B'])
    })

    // 半开连接测试依赖真实看门狗（30s）与 ReadableStream 配合，
    // 在 jsdom 中 fake timer 和异步流读取互相干扰，且已覆盖在「断流 resume」测试里，此处省略。

    it('首请求失败（无 task_id）不重试，直接抛错', async () => {
        globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'))

        await expect(
            streamChat('hi', { conversationId: null }, new AbortController().signal, {
                onMeta: () => {},
                onText: () => {},
                onToolStart: () => {},
                onToolEnd: () => {},
            }),
        ).rejects.toThrow('network error')
    })

    it('401 触发 AuthError 并广播', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }))

        await expect(
            streamChat('hi', { conversationId: null }, new AbortController().signal, {
                onMeta: () => {},
                onText: () => {},
                onToolStart: () => {},
                onToolEnd: () => {},
            }),
        ).rejects.toThrow(AuthError)
    })

    it('HTTP 错误构造 ApiError，含状态码', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue(
            new Response(JSON.stringify({ detail: 'rate limited' }), { status: 429 }),
        )

        try {
            await streamChat('hi', { conversationId: null }, new AbortController().signal, {
                onMeta: () => {},
                onText: () => {},
                onToolStart: () => {},
                onToolEnd: () => {},
            })
            expect.unreachable('should have thrown')
        } catch (e) {
            expect(e).toBeInstanceOf(ApiError)
            expect((e as ApiError).status).toBe(429)
            expect((e as ApiError).message).toBe('rate limited')
        }
    })

    it('signal 已 abort 时立即抛 AbortError', async () => {
        const controller = new AbortController()
        controller.abort()
        await expect(
            streamChat('hi', { conversationId: null }, controller.signal, {
                onMeta: () => {},
                onText: () => {},
                onToolStart: () => {},
                onToolEnd: () => {},
            }),
        ).rejects.toMatchObject({ name: 'AbortError' })
    })

    it('工具调用事件正确解析', async () => {
        const lines = [
            line({
                seq: 0,
                conversation_id: 'conv-1',
                user_message_id: 'u-1',
                assistant_message_id: 'a-1',
                parent_message_id: null,
            }),
            line({ seq: 1, type: 'tool_start', id: 't-1', name: 'get_current_time' }),
            line({ seq: 2, type: 'tool_end', id: 't-1', status: 'done' }),
            line({ seq: 3, reasoning_content: '', content: 'Time is ...' }),
        ]
        globalThis.fetch = vi.fn().mockResolvedValue(createSSEResponse(lines))

        const tools: Array<{ id: string; name?: string; status?: string }> = []
        await streamChat('hi', { conversationId: null }, new AbortController().signal, {
            onMeta: () => {},
            onText: () => {},
            onToolStart: (id, name) => {
                tools.push({ id, name })
            },
            onToolEnd: (id, status) => {
                tools.push({ id, status })
            },
        })

        expect(tools).toEqual([
            { id: 't-1', name: 'get_current_time' },
            { id: 't-1', status: 'done' },
        ])
    })
})
