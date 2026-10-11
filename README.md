# 星野 (PL-Agent)

类 ChatGPT 的 AI 流式对话应用。

- **前端** React + TypeScript + Vite：fetch + ReadableStream 手写 SSE 解析，ref 缓冲 + requestAnimationFrame 打字机揭示，Markdown 块密封聚合，暂停 / 停止双语义，工具调用状态可视化
- **后端** FastAPI + PostgreSQL：AsyncOpenAI 流式转发，tool_calls 按 index 聚合后串行执行并回喂下一轮，JWT HttpOnly Cookie 鉴权，客户端中断兜底落库（JSONB 原子追加）

## Tech Stack

React / TypeScript / Vite / Tailwind CSS · Python / FastAPI / asyncpg / PostgreSQL / PyJWT / OpenAI API
