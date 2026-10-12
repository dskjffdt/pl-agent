import { describe, expect, it, vi } from 'vitest'
import type { SetStateAction } from 'react'
import type { ChatRecord } from '../api/type'
import { updateLastRecord } from './records'

function makeRecord(partial: Partial<ChatRecord> = {}): ChatRecord {
    return { id: 'r1', prompt: 'p', reasoning: [], content: ['a'], ...partial }
}

function mockSetRecords(initial: ChatRecord[] = []) {
    let state = initial
    const setRecords = vi.fn((fn: SetStateAction<ChatRecord[]>) => {
        state = typeof fn === 'function' ? fn(state) : fn
    })
    return { setRecords, getState: () => state }
}

describe('updateLastRecord', () => {
    it('更新最后一条记录', () => {
        const { setRecords, getState } = mockSetRecords([
            makeRecord({ id: 'r1' }),
            makeRecord({ id: 'r2', content: [] }),
        ])
        updateLastRecord(setRecords, (last) => {
            last.content = ['updated']
        })
        expect(getState()).toHaveLength(2)
        expect(getState()[0].content).toEqual(['a'])
        expect(getState()[1].content).toEqual(['updated'])
    })

    it('记录为空时不更新', () => {
        const { setRecords, getState } = mockSetRecords([])
        updateLastRecord(setRecords, (last) => {
            last.content = ['x']
        })
        expect(getState()).toEqual([])
        expect(setRecords).toHaveBeenCalledTimes(1)
    })

    it('不可变更新：不修改原记录对象', () => {
        const last = makeRecord({ id: 'r1' })
        const { setRecords, getState } = mockSetRecords([last])
        updateLastRecord(setRecords, (rec) => {
            rec.content = ['new']
        })
        // 原对象未被改动，新数组里是拷贝
        expect(last.content).toEqual(['a'])
        expect(getState()[0]).not.toBe(last)
        expect(getState()[0].content).toEqual(['new'])
    })
})
