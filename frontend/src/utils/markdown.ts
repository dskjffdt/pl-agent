// 扫描文本的语法标记状态：围栏是否未闭合、行内 ** 与 ` 的出现次数
// （fence 代码块区域内的 ** 和 ` 是代码内容，不计入行内标记）
function scanMarks(text: string): { fenceOpen: boolean; bold: number; code: number } {
    let fenceOpen = false
    let bold = 0
    let code = 0
    for (const line of text.split('\n')) {
        if (/^(```|~~~)/.test(line)) {
            fenceOpen = !fenceOpen
            continue
        }
        if (fenceOpen) continue
        let idx = line.indexOf('**')
        while (idx !== -1) {
            bold++
            idx = line.indexOf('**', idx + 2)
        }
        idx = line.indexOf('`')
        while (idx !== -1) {
            code++
            idx = line.indexOf('`', idx + 1)
        }
    }
    return { fenceOpen, bold, code }
}

// 文本语法是否配平：无未闭合围栏，** 与 ` 均成对出现
export function isBalanced(text: string): boolean {
    const { fenceOpen, bold, code } = scanMarks(text)
    return !fenceOpen && bold % 2 === 0 && code % 2 === 0
}

// 给未闭合的语法标记补临时闭合符，使文本可独立安全渲染。
// 同时处理围栏代码块（fence）和行内标记（**、`）。
export function closeSyntax(text: string): string {
    let result = text
    const { fenceOpen, bold, code } = scanMarks(result)
    if (fenceOpen) result += '\n```'
    if (bold % 2 !== 0) result += '**'
    if (code % 2 !== 0) result += '`'
    return result
}
