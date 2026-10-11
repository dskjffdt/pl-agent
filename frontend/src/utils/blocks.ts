import { closeSyntax, isBalanced } from './markdown'

// 块大小阈值：攒满这么多字符才密封一个完整块
const BLOCK_CHARS = 200

// 尝试从 buffer 中切出一个块（调用方保证非 force 时 buffer 已达块大小）
// 闭合条件：切点前所有语法标记（围栏、**、`）均配平；
// 未配平就后移切点继续找，找不到则不闭合、继续追加。
// force=true 时跳过配平要求整段产出（用于流结束时的最终 flush，交给 closeSyntax 补闭合）
function tryFlush(buffer: string, force = false): { flush: string | null; remainder: string } {
    // 候选切点：优先 200 字符附近的行边界（换行跟随前块，下一块从行首开始）
    let cut = BLOCK_CHARS
    const lineBreak = buffer.lastIndexOf('\n', BLOCK_CHARS)
    if (lineBreak > 0) cut = lineBreak + 1
    if (cut > buffer.length) cut = buffer.length

    // 切点前缀语法配平才切；未配平（围栏未闭合 / ** 或 ` 奇数）就后移到下一个行边界，
    // 让块自然延伸到配平处，避免产出"只有半截格式"的块
    for (;;) {
        if (isBalanced(buffer.slice(0, cut))) {
            return { flush: buffer.slice(0, cut), remainder: buffer.slice(cut) }
        }
        if (cut >= buffer.length) break
        const next = buffer.indexOf('\n', cut)
        cut = next === -1 ? buffer.length : next + 1
    }

    // 找不到配平切点：非强制时继续追加；force 时整段产出（closeSyntax 兜底补闭合）
    if (!force) return { flush: null, remainder: buffer }
    return { flush: buffer, remainder: '' }
}

// 累积器：管理 reasoning / content 的缓冲和分块
export class BlockAccumulator {
    private buffer = ''

    /** 追加新文本，返回新产生的块 */
    push(text: string): string[] {
        this.buffer += text
        const newBlocks: string[] = []
        // 循环尝试切块，直到 buffer 太短
        while (this.buffer.length >= BLOCK_CHARS) {
            const { flush, remainder } = tryFlush(this.buffer)
            if (flush === null) break
            // 能切出的块必然已配平，无需 closeSyntax 补闭合
            newBlocks.push(flush)
            this.buffer = remainder
        }
        return newBlocks
    }

    /** 流结束时 flush 剩余 buffer */
    flush(): string[] {
        const newBlocks: string[] = []
        while (this.buffer.length > 0) {
            const { flush, remainder } = tryFlush(this.buffer, true)
            if (flush === null) break
            newBlocks.push(closeSyntax(flush))
            this.buffer = remainder
        }
        return newBlocks
    }

    /** 获取当前未产出的缓冲内容（用于逐字显示） */
    getBuffer(): string {
        return this.buffer
    }
}
