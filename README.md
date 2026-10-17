# 星野 (PL-Agent)

类 ChatGPT 的 AI 流式对话应用。

- **前端** React + TypeScript + Vite：fetch + ReadableStream 手写 SSE 解析，看门狗检测半开连接后按事件序号断线续传（指数退避），多会话并行流式按会话隔离、切换不中断，rAF 帧合批渲染，消息树分支重试，会话 id 前端生成实现乐观导航
- **后端** FastAPI + PostgreSQL：生成任务与 HTTP 连接解耦（事件按 seq 缓冲、重连补发、无订阅宽限取消），token 预算裁剪 + 滚动摘要 + 长期记忆注入上下文，tool_calls 按 index 聚合后串行执行并回喂，JWT HttpOnly Cookie 鉴权，中断兜底落库（JSONB 原子追加）

## Tech Stack

React / TypeScript / Vite / Zustand / Tailwind CSS · Python / FastAPI / asyncpg / PostgreSQL / PyJWT / OpenAI API
