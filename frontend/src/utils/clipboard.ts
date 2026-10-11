// 复制文本到剪贴板：优先 Clipboard API（需安全上下文），
// 失败时回退隐藏 textarea + execCommand（兼容 http 部署环境）
export async function copyText(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        ta.remove()
        return ok
    }
}
