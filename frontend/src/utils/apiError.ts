// API 错误统一构造：从后端错误响应中提取 detail 字段，兜底为通用文案
// 后端 FastAPI 的 HTTPException 返回格式为 { "detail": "具体原因" }，
// 但也可能是纯文本、HTML 或空 body——所有情况都要兜底，不能让 res.json() 的 SyntaxError 破坏错误翻译层

const NETWORK_MESSAGES: Record<string, string> = {
    FailedToFetch: '网络连接失败，请检查网络后重试',
    AbortError: '请求已取消',
}

// 根据 HTTP 状态码给一个兜底文案（当后端没返回 detail 时）
function fallbackMessage(status: number): string {
    if (status === 404) return '请求的资源不存在'
    if (status === 422) return '请求参数有误'
    if (status >= 500) return '服务器异常，请稍后重试'
    return `请求失败（HTTP ${status}）`
}

/**
 * 带状态码的 API 错误：保留 HTTP status 供调用方做分支判断（如 404 回新会话），
 * 同时用 cause 保留原始 Error 栈信息，方便 console 追溯
 */
export class ApiError extends Error {
    public status: number

    constructor(status: number, message: string, cause: unknown = undefined) {
        super(message, cause !== undefined ? { cause } : undefined)
        this.name = 'ApiError'
        this.status = status
    }
}

/**
 * 从 fetch 响应构造 ApiError，message 优先取后端 detail 字段
 * 必须用 try/catch 包裹 res.json()，因为错误响应体可能是非 JSON（纯文本/HTML/空）
 */
export async function buildApiError(res: Response): Promise<ApiError> {
    let detail: string | null = null
    try {
        const data = (await res.json()) as { detail?: string } | null
        detail = data?.detail ?? null
    } catch {
        // res.json() 抛 SyntaxError → 非 JSON 响应体，detail 保持 null
    }
    // 后端 detail 可能是空字符串，也要兜底
    const msg = detail && detail.trim() ? detail : fallbackMessage(res.status)
    return new ApiError(res.status, msg)
}

/**
 * 网络层错误（fetch 本身失败，不走 HTTP 状态码）统一翻译
 * err.message 在某些浏览器下是 TypeError: Failed to fetch，需要映射成用户能懂的话
 * 用 cause 保留原始错误栈方便追溯
 */
export function buildNetworkError(err: unknown): Error {
    if (err instanceof DOMException && err.name === 'AbortError') {
        return new Error(NETWORK_MESSAGES.AbortError, { cause: err })
    }
    if (err instanceof TypeError && err.message.includes('fetch')) {
        return new Error(NETWORK_MESSAGES.FailedToFetch, { cause: err })
    }
    if (err instanceof Error) {
        // 已有 Error 对象（如 ApiError），保持原类型不变
        return err
    }
    return new Error('网络异常', { cause: err })
}
