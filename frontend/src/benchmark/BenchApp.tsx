import { Suspense, lazy, memo, useEffect, useRef, useState, type RefObject } from 'react'

// markdown 渲染器动态加载（与真实 MarkdownBlock 实现同构）：
// 两组共用同一加载策略，chunk 在测试早期就绪后对比才公平
const MarkdownLazy = lazy(async () => {
    const [md, gfm] = await Promise.all([import('react-markdown'), import('remark-gfm')])
    const Markdown = md.default
    const Gfm = gfm.default
    function Compiled({ children }: { children?: string }) {
        return <Markdown remarkPlugins={[Gfm]}>{children}</Markdown>
    }
    return { default: Compiled }
})

const MdBlock = memo(function MdBlock({ text }: { text: string }) {
    return <MarkdownLazy>{text}</MarkdownLazy>
})

function Md({ text }: { text: string }) {
    return (
        <Suspense fallback={<span>{text}</span>}>
            <MdBlock text={text} />
        </Suspense>
    )
}

/**
 * 流式渲染基准测试 v2
 *
 * 两组共用同一份预生成 chunk 序列（固定输入），事件驱动计时：
 *  - A 未优化：每 chunk setState，react-markdown 全量重渲染整棵树
 *  - B 优化（复刻 useTypewriter 语义）：chunk 进 ref 缓冲，rAF 每帧揭固定字数（纯文本），
 *    无新数据跳过 setState；每 BLOCK_SIZE 字符密封一块，markdown 只在密封时渲染一次
 *
 * 结束条件：输入发完 且 渲染追平（A：双 rAF 确认最终 commit；B：缓冲与揭示全部完成）
 * 指标：React 重渲染次数、端到端显示完成时间、long task、平均/最低 FPS
 */

// ---------- 固定输入 ----------

const SEGMENTS: string[] = [
  '\n\n使用 **requestAnimationFrame** 把揭示节奏绑定到屏幕刷新：\n\n```ts\nconst tick = () => {\n  const take = Math.min(buf.length, CHARS_PER_FRAME)\n  buf = buf.slice(take)\n}\n```\n\n要点有三：\n\n1. 到达速率高于渲染频率时先入缓冲\n2. 每帧最多一次 setState\n3. 无新数据时跳过渲染\n',
  '\n\nSSE 按 `\\n` 分帧，跨 chunk 的半行要留在缓冲里等下一片。JSON 载荷里转义的换行是字面量 `\\n`，不会破坏分帧。\n\n> 帧解析是纯函数：输入原始字节流，输出事件序列。\n\n工具调用的参数以 **delta 分片**跨帧到达，必须按 index 聚齐全量后再解析，边收边解析会拿到残缺 JSON。\n',
  '\n\n密封块的意义：markdown 树只编译一次，之后是静态节点，React 跳过 diff。growing 部分用纯文本 `<span>` 揭示，避开逐 token 重解析。\n\n- 密封阈值 240 字符\n- 揭示速率约 16 字/帧\n- 中断时残余缓冲密封保留，已生成内容不丢失\n',
]

const CHUNK_INTERVAL_MS = 4
const CHUNKS_PER_TICK = 2
const CHUNK_TOTAL = 4000
const BLOCK_SIZE = 240
const CHARS_PER_FRAME = 40
const HARD_DEADLINE_MS = 60_000

// 密封块静态化：md 不变时跳过整棵 markdown 子树的 reconcile
const SealedBlock = memo(function SealedBlock({ md }: { md: string }) {
    return <Md text={md} />
})

function makeChunks(): string[] {
  const chunks: string[] = []
  let seg = 0
  let idx = 0
  while (chunks.length < CHUNK_TOTAL) {
    const text = SEGMENTS[seg % SEGMENTS.length]
    const size = 3 + Math.floor(Math.random() * 4)
    let out = ''
    for (let k = 0; k < size && chunks.length < CHUNK_TOTAL; k++) {
      if (idx >= text.length) {
        seg++
        idx = 0
        out += '\n\n'
        break
      }
      out += text[idx++]
    }
    chunks.push(out)
  }
  return chunks
}

const CHUNKS = makeChunks()
const TOTAL_CHARS = CHUNKS.reduce((a, b) => a + b.length, 0)

// ---------- 指标采集 ----------

interface RunMetrics {
  label: string
  chunkCount: number
  totalChars: number
  renderCount: number
  longTaskCount: number
  longTaskTotalMs: number
  avgFps: number
  minFps: number
  endToEndMs: number
  backlogChars: number
  truncated: boolean
}

let renderCount = 0

class LongTaskProbe {
  private observer: PerformanceObserver | null = null
  count = 0
  totalMs = 0

  start() {
    this.count = 0
    this.totalMs = 0
    this.observer = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        this.count++
        this.totalMs += e.duration
      }
    })
    this.observer.observe({ type: 'longtask', buffered: false })
  }

  stop() {
    this.observer?.disconnect()
    this.observer = null
  }
}

class FpsProbe {
  private rafId = 0
  private deltas: number[] = []
  private last = 0

  start() {
    this.deltas = []
    this.last = performance.now()
    const loop = (t: number) => {
      this.deltas.push(t - this.last)
      this.last = t
      this.rafId = requestAnimationFrame(loop)
    }
    this.rafId = requestAnimationFrame(loop)
  }

  stop(): { avgFps: number; minFps: number } {
    cancelAnimationFrame(this.rafId)
    if (this.deltas.length < 2) return { avgFps: 0, minFps: 0 }
    const valid = this.deltas.slice(1).filter((d) => d < 1000)
    const avgDelta = valid.reduce((a, b) => a + b, 0) / valid.length
    const minFps = Math.round(1000 / Math.max(...valid))
    return { avgFps: Math.round(1000 / avgDelta), minFps }
  }
}

function startStream(onChunk: (s: string) => void, onAllSent: () => void): () => void {
  let i = 0
  const start = performance.now()
  let timer = 0
  const tick = () => {
    if (performance.now() - start > HARD_DEADLINE_MS) {
      onAllSent()
      return
    }
    for (let k = 0; k < CHUNKS_PER_TICK && i < CHUNKS.length; k++) {
      onChunk(CHUNKS[i++])
    }
    if (i >= CHUNKS.length) {
      onAllSent()
      return
    }
    timer = window.setTimeout(tick, CHUNK_INTERVAL_MS)
  }
  timer = window.setTimeout(tick, CHUNK_INTERVAL_MS)
  return () => window.clearTimeout(timer)
}

const nextDoubleRaf = (fn: () => void) => {
  requestAnimationFrame(() => requestAnimationFrame(fn))
}

// ---------- 模式 A：未优化 ----------

function UnoptimizedRunner({
  streamRef,
  onFinished,
}: {
  streamRef: RefObject<(() => void) | null>
  onFinished: () => void
}) {
  renderCount++
  const [text, setText] = useState('')
  const finishedRef = useRef(false)
  const finish = useRef(onFinished)
  finish.current = onFinished

  useEffect(() => {
    const stop = startStream(
      (s) => setText((p) => p + s),
      () => {
        if (finishedRef.current) return
        finishedRef.current = true
        nextDoubleRaf(() => finish.current())
      },
    )
    streamRef.current = stop
    return () => stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="viewport">
      <Md text={text} />
    </div>
  )
}

// ---------- 模式 B：优化 ----------

function OptimizedRunner({
  streamRef,
  onFinished,
}: {
  streamRef: RefObject<(() => void) | null>
  onFinished: () => void
}) {
  renderCount++
  const [sealed, setSealed] = useState<string[]>([])
  const [growing, setGrowing] = useState('')
  const bufRef = useRef('')
  const growingRef = useRef('')
  const allSentRef = useRef(false)
  const finishedRef = useRef(false)
  const finish = useRef(onFinished)
  finish.current = onFinished

  useEffect(() => {
    const stop = startStream(
      (s) => {
        bufRef.current += s
      },
      () => {
        allSentRef.current = true
      },
    )
    streamRef.current = stop

    let rafId = 0
    const loop = () => {
      const buf = bufRef.current
      if (buf.length > 0) {
        const take = Math.min(buf.length, CHARS_PER_FRAME)
        growingRef.current += buf.slice(0, take)
        bufRef.current = buf.slice(take)
        setGrowing(growingRef.current)
        if (growingRef.current.length >= BLOCK_SIZE) {
          const block = growingRef.current
          growingRef.current = ''
          setGrowing('')
          setSealed((p) => [...p, block])
        }
      }
      if (allSentRef.current && bufRef.current.length === 0 && !finishedRef.current) {
        finishedRef.current = true
        nextDoubleRaf(() => finish.current())
        return
      }
      rafId = requestAnimationFrame(loop)
    }
    rafId = requestAnimationFrame(loop)

    return () => {
      stop()
      cancelAnimationFrame(rafId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="viewport">
      {sealed.map((m, i) => (
        <SealedBlock key={i} md={m} />
      ))}
      <span>{growing}</span>
    </div>
  )
}

// ---------- 测试状态机 ----------

const IDLE = 'idle'
const RUN_A = 'run-a'
const GAP = 'gap'
const RUN_B = 'run-b'
const DONE = 'done'

export default function BenchApp() {
  const [phase, setPhase] = useState(IDLE)
  const [metricsA, setMetricsA] = useState<RunMetrics | null>(null)
  const [metricsB, setMetricsB] = useState<RunMetrics | null>(null)
  const streamRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (phase !== RUN_A && phase !== RUN_B) return
    const longTask = new LongTaskProbe()
    const fps = new FpsProbe()
    renderCount = 0
    const start = performance.now()

    let deadline = 0
    longTask.start()
    fps.start()
    deadline = window.setTimeout(() => {
      // 兜底：超时强制结束，标记 truncated
      streamRef.current?.()
      collect(true)
    }, HARD_DEADLINE_MS + 2000)

    const collect = (truncated: boolean) => {
      window.clearTimeout(deadline)
      const { avgFps, minFps } = fps.stop()
      longTask.stop()
      const m: RunMetrics = {
        label:
          phase === RUN_A
            ? 'A 未优化（逐chunk setState + 全量markdown重渲染）'
            : 'B 优化（ref缓冲 + rAF合帧 + 密封块）',
        chunkCount: CHUNKS.length,
        totalChars: TOTAL_CHARS,
        renderCount,
        longTaskCount: longTask.count,
        longTaskTotalMs: Math.round(longTask.totalMs),
        avgFps,
        minFps,
        endToEndMs: Math.round(performance.now() - start),
        backlogChars: 0,
        truncated,
      }
      if (phase === RUN_A) {
        setMetricsA(m)
        setPhase(GAP)
      } else {
        setMetricsB(m)
        setPhase(DONE)
      }
    }
    finishRef.current = () => collect(false)

    return () => {
      window.clearTimeout(deadline)
      streamRef.current?.()
      fps.stop()
      longTask.stop()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const finishRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (phase === IDLE) {
      const t = window.setTimeout(() => setPhase(RUN_A), 1200)
      return () => window.clearTimeout(t)
    }
    if (phase === GAP) {
      const t = window.setTimeout(() => setPhase(RUN_B), 3000)
      return () => window.clearTimeout(t)
    }
  }, [phase])

  const result = metricsA && metricsB ? JSON.stringify({ A_unoptimized: metricsA, B_optimized: metricsB }, null, 2) : ''

  return (
    <>
      <div className={`panel ${phase === RUN_A ? 'running' : metricsA ? 'done' : ''}`}>
        <h2>模式 A：未优化</h2>
        <div className="stats">
          {metricsA
            ? `chunks=${metricsA.chunkCount}  字符=${metricsA.totalChars}  React重渲染=${metricsA.renderCount}\n端到端显示完成=${metricsA.endToEndMs}ms（truncated=${metricsA.truncated}）\nlong task=${metricsA.longTaskCount} 次 / 共 ${metricsA.longTaskTotalMs}ms 阻塞\nFPS 平均 ${metricsA.avgFps} / 最低 ${metricsA.minFps}`
            : phase === RUN_A
              ? '运行中…'
              : '等待'}
        </div>
        {phase === RUN_A && (
          <UnoptimizedRunner
            streamRef={streamRef}
            onFinished={() => finishRef.current()}
          />
        )}
      </div>

      <div className={`panel ${phase === RUN_B ? 'running' : metricsB ? 'done' : ''}`}>
        <h2>模式 B：优化</h2>
        <div className="stats">
          {metricsB
            ? `chunks=${metricsB.chunkCount}  字符=${metricsB.totalChars}  React重渲染=${metricsB.renderCount}\n端到端显示完成=${metricsB.endToEndMs}ms（truncated=${metricsB.truncated}）\nlong task=${metricsB.longTaskCount} 次 / 共 ${metricsB.longTaskTotalMs}ms 阻塞\nFPS 平均 ${metricsB.avgFps} / 最低 ${metricsB.minFps}`
            : phase === RUN_B
              ? '运行中…'
              : '等待'}
        </div>
        {phase === RUN_B && (
          <OptimizedRunner
            streamRef={streamRef}
            onFinished={() => finishRef.current()}
          />
        )}
      </div>

      {phase === DONE && <textarea id="out" readOnly value={result} />}
    </>
  )
}
