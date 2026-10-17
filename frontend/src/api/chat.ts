import { AuthError, handleUnauthorized } from './auth'
import { buildApiError } from '../utils/apiError'
import { API_BASE } from '../config'
import type { ChatCompletionResponse, ConversationDetail, SessionMeta } from './type'

// 401 统一出口：清凭证广播后抛 AuthError
function unauthorized(): never {
    handleUnauthorized()
    throw new AuthError('登录已过期')
}

// 会话列表（侧栏）。凭证在 HttpOnly cookie 里，同源请求自动携带
export async function listConversations(): Promise<SessionMeta[]> {
    const res = await fetch(`${API_BASE}/conversations`)
    if (res.status === 401) unauthorized()
    if (!res.ok) throw await buildApiError(res)
    return (await res.json()) as SessionMeta[]
}

// 会话详情（切换会话时拉取消息；支持分页）
export async function getConversation(
    id: string,
    opts?: { limit?: number; beforeId?: string },
): Promise<ConversationDetail> {
    const params = new URLSearchParams()
    if (opts?.limit) params.set('limit', String(opts.limit))
    if (opts?.beforeId) params.set('before_id', opts.beforeId)
    const qs = params.toString()
    const res = await fetch(`${API_BASE}/conversations/${id}${qs ? `?${qs}` : ''}`)
    if (res.status === 401) unauthorized()
    if (!res.ok) throw await buildApiError(res)
    return (await res.json()) as ConversationDetail
}

// 删除会话（侧栏入口；删除当前会话时由路由层负责回新会话并中止生成）
export async function deleteConversation(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/conversations/${id}`, { method: 'DELETE' })
    if (res.status === 401) unauthorized()
    if (!res.ok) throw await buildApiError(res)
}

type StreamHandlers = {
    // 首事件：会话 id + 树节点 id（前端把本地占位节点对齐到后端树）
    onMeta: (meta: {
        conversationId?: string
        userId?: string | null
        assistantId?: string
        parentId?: string | null
    }) => void
    // 正文/思考文本（可能为空串）
    onText: (reasoning: string, content: string) => void
    // 工具调用开始（离散事件，直接更新记录）
    onToolStart: (id: string, name: string) => void
    // 工具调用结束
    onToolEnd: (id: string, status: 'done' | 'error') => void
}

type StreamParams = {
    conversationId: string | null
    // 树挂点：新轮 = 当前活跃链尾；重试 = 被重试 assistant 的父（user 节点）id
    parentId?: string | null
    // 重试分支模式：不落库 user 消息，新 assistant 直接挂 parentId 下
    retry?: boolean
}

// 看门狗阈值：2× 服务端心跳间隔（15s）。超过该时长未收到任何字节（含 :ping），
// 判定为半开连接（拔网线/代理静默掐断，TCP 栈无 RST/FIN，read 会永久挂起）
const WATCHDOG_TIMEOUT_MS = 30_000
// resume 最大重试次数：退避 0.5s→1s→2s→4s→8s，累计约 16s，落在服务端 60s 宽限窗口内
const MAX_RESUME_RETRIES = 5

function backoffMs(attempt: number): number {
    return Math.min(500 * 2 ** attempt, 8000)
}

// 可被用户停止打断的退避等待，避免断线重试期间点停止要等满退避时长
function interruptibleDelay(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) {
            reject(new DOMException('Aborted', 'AbortError'))
            return
        }
        const onAbort = () => {
            clearTimeout(timer)
            reject(new DOMException('Aborted', 'AbortError'))
        }
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort)
            resolve()
        }, ms)
        signal.addEventListener('abort', onAbort, { once: true })
    })
}

// 流式对话：首次 POST 建立生成任务；连接中断（看门狗判定半开/网络错误）时按事件 seq
// 走 GET /chat/resume 续传，指数退避最多 5 次。signal 中断 = 用户主动停止，通知后端取消
export async function streamChat(prompt: string, params: StreamParams, signal: AbortSignal, handlers: StreamHandlers) {
    const { onMeta, onText, onToolStart, onToolEnd } = handlers
    // 任务身份随 meta(seq0) 拿到；lastSeq 为已处理的最大事件序号
    let taskId: string | null = null
    let lastSeq = -1
    let resumeAttempts = 0
    // 每次连接一个独立 controller：看门狗只中断当前连接以便 resume；外层 signal 中断则整体停止
    let attemptController: AbortController | null = null
    const stopAttempt = () => attemptController?.abort()
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    signal.addEventListener('abort', stopAttempt, { once: true })

    // 用户主动停止：立即通知后端取消后台生成（断网/登出时请求失败无意义，静默忽略）
    const fireCancel = async () => {
        if (!taskId) return
        try {
            await fetch(`${API_BASE}/chat/cancel/${encodeURIComponent(taskId)}`, { method: 'POST' })
        } catch {
            /* 忽略取消请求失败 */
        }
    }

    try {
        while (true) {
            if (signal.aborted) {
                await fireCancel()
                throw new DOMException('Aborted', 'AbortError')
            }
            attemptController = new AbortController()

            let res: Response
            try {
                res = taskId === null
                    ? await fetch(`${API_BASE}/chat/completions`, {
                          headers: { 'Content-Type': 'application/json' },
                          method: 'POST',
                          body: JSON.stringify({
                              prompt,
                              conversation_id: params.conversationId,
                              parent_message_id: params.parentId ?? null,
                              retry: params.retry === true,
                          }),
                          signal: attemptController.signal,
                      })
                    : await fetch(
                          `${API_BASE}/chat/resume/${encodeURIComponent(taskId)}?after_seq=${lastSeq}`,
                          { signal: attemptController.signal },
                      )
            } catch (e) {
                if (signal.aborted) {
                    await fireCancel()
                    throw new DOMException('Aborted', 'AbortError')
                }
                // 首请求（无任务身份）失败不重试：POST 非幂等，重试可能重复建会话/落消息
                if (taskId && resumeAttempts < MAX_RESUME_RETRIES) {
                    try {
                        await interruptibleDelay(backoffMs(resumeAttempts), signal)
                    } catch {
                        await fireCancel()
                        throw new DOMException('Aborted', 'AbortError')
                    }
                    resumeAttempts++
                    continue
                }
                throw e
            }

            if (res.status === 401) unauthorized()
            if (!res.ok || !res.body) throw await buildApiError(res)

            // 单行协议：JSON 数据行；冒号开头是 SSE 注释（服务端空闲心跳 ": ping"），直接跳过
            const handleLine = (raw: string) => {
                const line = raw.trim()
                if (!line || line.startsWith(':')) return
                const data = JSON.parse(line) as ChatCompletionResponse
                if (typeof data.seq === 'number') lastSeq = data.seq
                if (data.assistant_message_id) taskId = data.assistant_message_id
                // 首事件含 assistant_message_id，据此识别元信息（部分兼容 conversation_id 单独到场）
                if (data.assistant_message_id || data.conversation_id) {
                    onMeta({
                        conversationId: data.conversation_id,
                        userId: data.user_message_id,
                        assistantId: data.assistant_message_id,
                        parentId: data.parent_message_id,
                    })
                }
                onText(data.reasoning_content ?? '', data.content ?? '')

                const { type, id, name, status } = data
                if (type === 'tool_start' && id && name) onToolStart(id, name)
                if (type === 'tool_end' && id) onToolEnd(id, status === 'error' ? 'error' : 'done')
            }

            // 看门狗：收到任意字节（数据行或心跳）都刷新；超时中断当前连接触发 resume
            let lastReceived = Date.now()
            const watchdog = setInterval(() => {
                if (Date.now() - lastReceived > WATCHDOG_TIMEOUT_MS) attemptController?.abort()
            }, 1000)

            let ended = false
            try {
                const reader = res.body.getReader()
                const decoder = new TextDecoder()
                let buffer = ''
                while (true) {
                    const { done, value } = await reader.read()
                    if (done) break
                    lastReceived = Date.now()
                    buffer += decoder.decode(value, { stream: true })
                    const lines = buffer.split('\n')
                    buffer = lines.pop()!
                    for (const line of lines) {
                        handleLine(line)
                    }
                }
                // 处理循环后残留数据
                if (buffer.trim()) {
                    try {
                        handleLine(buffer)
                    } catch {
                        /* 残留不是合法 JSON，忽略 */
                    }
                }
                ended = true
            } catch (e) {
                if (signal.aborted) {
                    await fireCancel()
                    throw new DOMException('Aborted', 'AbortError')
                }
                // 看门狗触发或读取中途断裂：有任务身份则退避 resume（事件 seq 保证不重复）
                if (taskId && resumeAttempts < MAX_RESUME_RETRIES) {
                    try {
                        await interruptibleDelay(backoffMs(resumeAttempts), signal)
                    } catch {
                        await fireCancel()
                        throw new DOMException('Aborted', 'AbortError')
                    }
                    resumeAttempts++
                    continue
                }
                throw e
            } finally {
                clearInterval(watchdog)
            }

            if (ended) return
        }
    } finally {
        signal.removeEventListener('abort', stopAttempt)
    }
}
