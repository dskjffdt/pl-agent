import { describe, expect, it, vi } from 'vitest'
import type { ChatRecord } from '../api/type'
import { updateLastRecord } from './records'

function makeRecord(partial: Partial<ChatRecord> = {}): ChatRecord {
    return { id: 'r1', prompt: 'p', reasoning: [], content: ['a'], ...partial }
}

describe('updateLastRecord', () => {
    it('更新最后一条记录', () => {
        let state = [makeRecord({ id: 'r1' }), makeRecord({ id: 'r2', content: [] })]
        const setRecords = vi.fn((fn: (prev: ChatRecord[]) => ChatRecord[]) => {
            state = fn(state)
        })
        updateLastRecord(setRecords, (last) => {
            last.content = ['updated']
        })
        expect(state).toHaveLength(2)
        expect(state[0].content).toEqual(['a'])
        expect(state[1].content).toEqual(['updated'])
    })

    it('记录为空时不更新', () => {
        let state: ChatRecord[] = []
        const setRecords = vi.fn((fn: (prev: ChatRecord[]) => ChatRecord[]) => {
            state = fn(state)
        })
        updateLastRecord(setRecords, (last) => {
            last.content = ['x']
        })
        expect(state).toEqual([])
        expect(setRecords).toHaveBeenCalledTimes(1)
    })

    it('不可变更新：不修改原记录对象', () => {
        const last = makeRecord({ id: 'r1' })
        let state = [last]
        const setRecords = vi.fn((fn: (prev: ChatRecord[]) => ChatRecord[]) => {
            state = fn(state)
        })
        updateLastRecord(setRecords, (rec) => {
            rec.content = ['new']
        })
        // 原对象未被改动，新数组里是拷贝
        expect(last.content).toEqual(['a'])
        expect(state[0]).not.toBe(last)
        expect(state[0].content).toEqual(['new'])
    })
})
