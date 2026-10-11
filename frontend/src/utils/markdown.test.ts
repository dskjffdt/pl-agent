import { describe, expect, it } from 'vitest'
import { closeSyntax } from './markdown'

describe('closeSyntax', () => {
    it('闭合语法文本原样返回', () => {
        expect(closeSyntax('普通文本')).toBe('普通文本')
        expect(closeSyntax('**加粗** 和 `代码`')).toBe('**加粗** 和 `代码`')
    })

    it('奇数个围栏代码块补闭合符', () => {
        const input = '开头\n```js\nconst a = 1\n'
        const result = closeSyntax(input)
        expect(result.endsWith('\n```')).toBe(true)
        expect(result.startsWith(input)).toBe(true)
    })

    it('偶数个围栏代码块不补', () => {
        const input = '```js\nconst a = 1\n```\n后文'
        expect(closeSyntax(input)).toBe(input)
    })

    it('奇数个加粗标记补闭合', () => {
        expect(closeSyntax('未闭合**加粗')).toBe('未闭合**加粗**')
    })

    it('奇数个行内代码标记补闭合', () => {
        expect(closeSyntax('未闭合`代码')).toBe('未闭合`代码`')
    })

    it('围栏内的行内标记不参与计数', () => {
        // ``` 与 ** 都在代码块内，代码块自身闭合，不补任何符号
        const input = '```js\nconst a = **b**;\n```\n'
        expect(closeSyntax(input)).toBe(input)
    })
})
