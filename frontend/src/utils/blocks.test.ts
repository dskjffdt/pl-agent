import { describe, expect, it } from 'vitest'
import { BlockAccumulator } from './blocks'
import { isBalanced } from './markdown'

describe('BlockAccumulator.push', () => {
    it('不足块大小时不产出块，内容累积在缓冲', () => {
        const acc = new BlockAccumulator()
        const blocks = acc.push('hello')
        expect(blocks).toEqual([])
        expect(acc.getBuffer()).toBe('hello')
    })

    it('超过块大小时按行边界切块，换行跟随前块', () => {
        const acc = new BlockAccumulator()
        // 250 字符带换行：第一块应到最后一个换行（含）为止，下一块从行首开始
        const text = `${'a'.repeat(50)}\n${'b'.repeat(199)}`
        const blocks = acc.push(text)
        expect(blocks).toEqual([`${'a'.repeat(50)}\n`])
        expect(acc.getBuffer()).toBe('b'.repeat(199))
    })

    it('无换行时在块大小处硬切', () => {
        const acc = new BlockAccumulator()
        const blocks = acc.push('x'.repeat(250))
        expect(blocks).toEqual(['x'.repeat(200)])
        expect(acc.getBuffer()).toBe('x'.repeat(50))
    })

    it('连续追加可产出多个块', () => {
        const acc = new BlockAccumulator()
        const blocks1 = acc.push(`${'a'.repeat(200)}\n`)
        const blocks2 = acc.push(`${'b'.repeat(200)}\n`)
        expect(blocks1).toEqual([`${'a'.repeat(200)}\n`])
        expect(blocks2).toEqual([`${'b'.repeat(200)}\n`])
        expect(acc.getBuffer()).toBe('')
    })
})

describe('BlockAccumulator.flush', () => {
    it('强制产出缓冲残余（不足块大小也切）', () => {
        const acc = new BlockAccumulator()
        acc.push('short text')
        expect(acc.flush()).toEqual(['short text'])
        expect(acc.getBuffer()).toBe('')
    })

    it('空缓冲 flush 不产出', () => {
        const acc = new BlockAccumulator()
        expect(acc.flush()).toEqual([])
    })
})

describe('closeSyntax 集成（块产出应语法闭合）', () => {
    it('围栏未闭合（格式不配平）时不闭合，继续追加到流结束', () => {
        const acc = new BlockAccumulator()
        // 总长超块大小，但切点前后围栏都未配平：不产出块
        const text = `${'a'.repeat(100)}\n\`\`\`js\nconsole.log(1)\n${'b'.repeat(100)}\n`
        expect(acc.push(text)).toEqual([])
        // 流结束强制产出：closeSyntax 给未闭合围栏补闭合（偶数个围栏行）
        const sealed = acc.flush()
        expect(sealed.length).toBe(1)
        const fences = sealed[0].match(/^```/gm) ?? []
        expect(fences.length % 2).toBe(0)
    })

    it('行内标记奇数（** 未配平）时不闭合，配平后恢复产出', () => {
        const acc = new BlockAccumulator()
        // ** 在切点之前且未配平：不产出，继续追加
        const odd = `开头 **加粗 ${'x'.repeat(200)}`
        expect(acc.push(odd)).toEqual([])
        // ** 配平后：切点后移到配平边界，恢复产块
        const blocks = acc.push(` 结束**\n${'y'.repeat(200)}`)
        expect(blocks.length).toBeGreaterThan(0)
    })

    it('代码块跨越块边界时整体闭合，产出块各自语法配平', () => {
        const acc = new BlockAccumulator()
        // 回归：长代码块横跨 200 字符切点时，后半段代码曾失去开头围栏被当纯文本
        const code = Array.from({ length: 30 }, (_, i) => `let v${i} = ${i};`).join('\n')
        const text = `说明文字\n\`\`\`js\n${code}\n\`\`\`\n收尾\n`
        const blocks = acc.push(text)
        const sealed = acc.flush()
        const all = [...blocks, ...sealed]
        // 所有块拼接后与原文一致：没有 closeSyntax 补出来的临时闭合符
        expect(all.join('')).toBe(text)
        // 每个块独立语法配平，不存在靠补闭合才能渲染的残块
        for (const block of all) {
            expect(isBalanced(block)).toBe(true)
        }
        // 代码块没有被从中间切开：opener 与全部代码行在同一个块里
        const codeBlock = all.find((b) => b.includes('```js'))
        expect(codeBlock).toContain('let v0 = 0;')
        expect(codeBlock).toContain('let v29 = 29;')
    })
})
