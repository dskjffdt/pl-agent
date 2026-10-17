// jsdom 无 crypto.randomUUID，mock 为固定值便于测试断言
Object.defineProperty(globalThis, 'crypto', {
    value: {
        randomUUID: () => 'mock-uuid',
    },
    writable: true,
})
