import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { sendMessage, stopStream, discardAll } from './actions'
import { useChatStreams } from './store'
import { runtimes } from './runtime'
import { AuthError } from '../../api/auth'

// Mock streamChat 以隔离测试 runtime 状态机
vi.mock('../../api/chat', () => ({
    streamChat: vi.fn(),
}))

// Mock uuid（jsdom 无 crypto.randomUUID，test-setup.ts 已 mock 为固定值）
vi.mock('uuid', () => ({
    v7: vi.fn(() => 'mock-uuid-7'),
}))

import { streamChat } from '../../api/chat'

function getEntry(chatId: string) {
    return useChatStreams.getState().entries.find((e) => e.chatId === chatId)
}

describe('流式状态机（sendMessage → runStream → seal）', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        useChatStreams.setState({ entries: [] })
        runtimes.clear()
    })

    afterEach(() => {
        discardAll()
    })

    it('正常流：pending → streaming → done，内容累积正确', async () => {
        vi.mocked(streamChat).mockImplementation(async (_prompt, _params, _signal, handlers) => {
            handlers.onMeta({ conversationId: 'chat-1', assistantId: 'a-1' })
            handlers.onText('', 'Hello')
            handlers.onText('', ' world')
        })

        sendMessage({ routeId: 'chat-1', prompt: 'hi' })
        await vi.waitFor(() => {
            expect(runtimes.has('chat-1')).toBe(false)
        })

        const entry = getEntry('chat-1')
        expect(entry?.nodes.get('a-1')?.record.status).toBe('done')
        expect(entry?.nodes.get('a-1')?.record.content).toBe('Hello world')
        expect(entry?.streaming).toBe(false)
    })

    it('用户停止：abort → status 变 aborted，保留已生成内容', async () => {
        vi.mocked(streamChat).mockImplementation(async (_prompt, _params, signal, handlers) => {
            handlers.onMeta({ conversationId: 'chat-1', assistantId: 'a-1' })
            handlers.onText('', 'partial')
            // 返回一个 promise，在 abort 时 reject
            return new Promise((_, reject) => {
                signal.addEventListener('abort', () => {
                    reject(new DOMException('Aborted', 'AbortError'))
                })
            })
        })

        sendMessage({ routeId: 'chat-1', prompt: 'hi' })
        // 给 streamChat 一点时间设置 abort listener
        await new Promise((r) => setTimeout(r, 0))
        stopStream('chat-1')

        await vi.waitFor(() => {
            expect(runtimes.has('chat-1')).toBe(false)
        })

        const entry = getEntry('chat-1')
        expect(entry?.nodes.get('a-1')?.record.status).toBe('aborted')
        expect(entry?.nodes.get('a-1')?.record.content).toBe('partial')
        expect(entry?.streaming).toBe(false)
    })

    it('网络错误：status 变 error，保留错误信息', async () => {
        vi.mocked(streamChat).mockRejectedValue(new Error('network error'))

        sendMessage({ routeId: 'chat-1', prompt: 'hi' })
        await vi.waitFor(() => {
            expect(runtimes.has('chat-1')).toBe(false)
        })

        const entry = getEntry('chat-1')
        expect(entry?.nodes.get('local-a-mock-uuid')?.record.status).toBe('error')
        expect(entry?.nodes.get('local-a-mock-uuid')?.record.error).toBe('network error')
        expect(entry?.streaming).toBe(false)
    })

    it('401 AuthError：status 变 aborted，不显示错误', async () => {
        vi.mocked(streamChat).mockRejectedValue(new AuthError('登录已过期'))

        sendMessage({ routeId: 'chat-1', prompt: 'hi' })
        await vi.waitFor(() => {
            expect(runtimes.has('chat-1')).toBe(false)
        })

        const entry = getEntry('chat-1')
        expect(entry?.nodes.get('local-a-mock-uuid')?.record.status).toBe('aborted')
        expect(entry?.nodes.get('local-a-mock-uuid')?.record.error).toBeUndefined()
    })

    it('meta 防重入：onServerConfirmed 只触发一次', async () => {
        const onServerConfirmed = vi.fn()

        vi.mocked(streamChat).mockImplementation(async (_prompt, _params, _signal, handlers) => {
            handlers.onMeta({ conversationId: 'chat-1', assistantId: 'a-1' })
            // resume 重放 meta
            handlers.onMeta({ conversationId: 'chat-1', assistantId: 'a-1' })
        })

        sendMessage({ routeId: 'chat-1', prompt: 'hi', onServerConfirmed })
        await vi.waitFor(() => {
            expect(runtimes.has('chat-1')).toBe(false)
        })

        expect(onServerConfirmed).toHaveBeenCalledTimes(1)
    })

    it('assistant id 对齐：本地占位 id 迁移到后端真 id', async () => {
        vi.mocked(streamChat).mockImplementation(async (_prompt, _params, _signal, handlers) => {
            handlers.onMeta({ conversationId: 'chat-1', assistantId: 'server-a-1' })
            handlers.onText('', 'done')
        })

        sendMessage({ routeId: 'chat-1', prompt: 'hi' })
        await vi.waitFor(() => {
            expect(runtimes.has('chat-1')).toBe(false)
        })

        const entry = getEntry('chat-1')
        expect(entry?.nodes.has('local-a-mock-uuid')).toBe(false)
        expect(entry?.nodes.has('server-a-1')).toBe(true)
        expect(entry?.nodes.get('server-a-1')?.record.id).toBe('server-a-1')
    })

    it('user id 对齐：本地占位 user id 迁移到后端真 id', async () => {
        vi.mocked(streamChat).mockImplementation(async (_prompt, _params, _signal, handlers) => {
            handlers.onMeta({ conversationId: 'chat-1', userId: 'server-u-1', assistantId: 'a-1' })
            handlers.onText('', 'done')
        })

        sendMessage({ routeId: 'chat-1', prompt: 'hi' })
        await vi.waitFor(() => {
            expect(runtimes.has('chat-1')).toBe(false)
        })

        const entry = getEntry('chat-1')
        expect(entry?.nodes.has('local-u-mock-uuid')).toBe(false)
        expect(entry?.nodes.has('server-u-1')).toBe(true)
        expect(entry?.nodes.get('server-u-1')?.record.id).toBe('server-u-1')
    })

    it('工具调用：tool_start → tool_end 状态正确更新', async () => {
        vi.mocked(streamChat).mockImplementation(async (_prompt, _params, _signal, handlers) => {
            handlers.onMeta({ conversationId: 'chat-1', assistantId: 'a-1' })
            handlers.onToolStart('t-1', 'get_current_time')
            handlers.onToolEnd('t-1', 'done')
            handlers.onText('', 'result')
        })

        sendMessage({ routeId: 'chat-1', prompt: 'hi' })
        await vi.waitFor(() => {
            expect(runtimes.has('chat-1')).toBe(false)
        })

        const entry = getEntry('chat-1')
        const record = entry?.nodes.get('a-1')?.record
        expect(record?.toolEvents).toEqual([{ id: 't-1', name: 'get_current_time', status: 'done' }])
    })
})
