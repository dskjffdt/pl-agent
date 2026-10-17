import asyncio
import json
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from asyncpg.exceptions import UniqueViolationError
from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.responses import StreamingResponse

import db
import jobs
import tokenizer
from auth import (
    clear_session_cookie,
    create_token,
    get_current_user_id,
    set_session_cookie,
    verify_password,
)
from context import build_chat_context
from llm import stream_chat
from schemas import ChatRequest, LoginRequest

# SSE 心跳间隔：模型（尤其推理模型）长时间不出字时按此间隔下发注释行，
# 让链路持续有字节流动，防 nginx/网关按静默超时（常见 60s）掐断连接
SSE_HEARTBEAT_SECONDS = 15
# 最后一个订阅连接断开后，后台生成任务的宽限存活时间：
# 断线重连必须在该窗口内完成，超时无重连则取消生成，防关页面后白烧 token
TASK_GRACE_SECONDS = 60
# 任务终态后事件缓冲保留时长：供迟到的 resume 补全完整事件流，过期清理
TASK_RETENTION_SECONDS = 600


class StreamTask:
    """一次生成任务：生命周期独立于 HTTP 连接。

    - gen_task 在后台跑模型流，事件按 seq 递增写入 events 缓冲（心跳是连接级的，不进缓冲）
    - 每个 SSE 连接只是一个订阅者，断开不影响生成；resume 按 after_seq 从缓冲补发
    """

    def __init__(self, task_id: str, user_id: int):
        self.id = task_id
        self.user_id = user_id
        self.events: list[tuple[int, dict]] = []
        self.cond = asyncio.Condition()
        self.done = False
        self.gen_task: asyncio.Task | None = None
        self.subscribers = 0
        self.grace_task: asyncio.Task | None = None


# 进程内任务注册表（单 worker 部署；多 worker 需粘性会话或外部存储）
TASKS: dict[str, StreamTask] = {}


async def _grace_cancel(task: StreamTask) -> None:
    """无订阅者宽限期满仍无重连：取消后台生成（由 run_generation 的 finally 落库）。"""
    try:
        await asyncio.sleep(TASK_GRACE_SECONDS)
    except asyncio.CancelledError:
        # 重连发生：event_subscriber 取消本任务
        return
    if task.subscribers == 0 and not task.done and task.gen_task is not None:
        task.gen_task.cancel()


async def event_subscriber(
    task: StreamTask, after_seq: int
) -> AsyncGenerator[bytes, None]:
    """把任务事件以 SSE 行喂给单个连接：先补发缓冲中 after_seq 之后的部分，再跟新事件。

    after_seq = 客户端已收到的最大 seq（首次连接为 -1，从 meta=seq0 开始）。"""
    task.subscribers += 1
    if task.grace_task is not None:
        task.grace_task.cancel()
        task.grace_task = None
    idx = after_seq + 1
    try:
        while True:
            try:
                async with task.cond:
                    while len(task.events) <= idx and not task.done:
                        await asyncio.wait_for(
                            task.cond.wait(), timeout=SSE_HEARTBEAT_SECONDS
                        )
                    pending = task.events[idx:]
                    idx = len(task.events)
                    done = task.done
            except asyncio.TimeoutError:
                # 空闲心跳：仅当前连接的保活字节，不入缓冲、不会被 resume 重放
                yield b": ping\n"
                continue
            for _, event in pending:
                yield (json.dumps(event, ensure_ascii=False) + "\n").encode()
            if done:
                break
    finally:
        task.subscribers -= 1
        if task.subscribers <= 0 and not task.done and task.grace_task is None:
            task.grace_task = asyncio.create_task(_grace_cancel(task))


def _sse_response(subscriber: AsyncGenerator[bytes, None]) -> StreamingResponse:
    return StreamingResponse(
        subscriber,
        media_type="text/event-stream",
        headers={
            # 关 nginx 响应缓冲：分片到达即转发，避免线上退化为"攒一批再一次性下发"的伪流式
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
        },
    )


async def _run_generation(
    task: StreamTask,
    *,
    conversation_id: uuid.UUID,
    prompt: str,
    persist_user: bool,
    user_node_id: uuid.UUID,
    assistant_node_id: uuid.UUID,
    fork_id: str | None,
    history: list[dict],
    user_id: int,
    generate_title: bool,
) -> None:
    """后台生成：模型流 → 事件缓冲；终态（完成/取消/异常）统一在 finally 落库。"""
    reasoning = ""
    content = ""
    saved = False

    async def persist() -> None:
        nonlocal saved
        if saved or not (content or reasoning):
            return
        saved = True
        records: list[dict] = []
        if persist_user:
            records.append({
                "id": str(user_node_id),
                "parent_id": fork_id,
                "role": "user",
                "content": prompt,
            })
        records.append({
            "id": str(assistant_node_id),
            # 新轮挂在 user 节点下；重试挂到被重试的 user 节点下形成兄弟分支
            "parent_id": str(user_node_id) if persist_user else fork_id,
            "role": "assistant",
            "content": content,
            "reasoning": reasoning,
        })
        await db.append_messages(conversation_id, records)

    async def push(event: dict) -> None:
        async with task.cond:
            task.events.append((len(task.events), event))
            task.cond.notify_all()

    agen = None
    next_event: asyncio.Task | None = None
    try:
        # 组装上下文（预算裁剪 + 摘要解析 + 记忆注入）在 try 内：失败走既有 finally 收尾语义
        ctx = await build_chat_context(user_id, history, prompt)
        agen = stream_chat(
            ctx.history, prompt, prefix_summary=ctx.summary, memories=ctx.memories
        )
        next_event = asyncio.ensure_future(agen.__anext__())
        while True:
            # 后台任务不面对连接，无需心跳竞速：有事件即写缓冲，订阅连接各自保活
            await next_event
            try:
                event = next_event.result()
            except StopAsyncIteration:
                break
            if event.get("type") == "result":
                # 正常完成：以汇总事件为准（输出过滤后只含确认安全的部分）
                reasoning = event["reasoning_content"]
                content = event["content"]
            else:
                reasoning += event.get("reasoning_content", "")
                content += event.get("content", "")
                await push(event)
            next_event = asyncio.ensure_future(agen.__anext__())
    finally:
        # 完成 / 用户取消 / 宽限取消 / 异常：取消挂起取数、关流、落库已生成内容
        if next_event is not None and not next_event.done():
            next_event.cancel()
            try:
                await next_event
            except (asyncio.CancelledError, Exception):
                pass
        if agen is not None:
            await agen.aclose()
        await persist()
        # 落库成功后触发后台任务：长期记忆提取 +（首轮）标题生成，不阻塞收尾
        if saved:
            jobs.after_turn(
                conversation_id=conversation_id,
                user_id=user_id,
                prompt=prompt,
                answer=content or reasoning,
                generate_title=generate_title,
            )
        async with task.cond:
            task.done = True
            task.cond.notify_all()
        asyncio.get_running_loop().call_later(
            TASK_RETENTION_SECONDS, lambda: TASKS.pop(task.id, None)
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.init()
    tokenizer.warmup()  # 启动自检：tokenizer 缺失/不兼容直接拒绝启动
    yield
    await db.close()


app = FastAPI(lifespan=lifespan)


# 安全响应头：nosniff 防 MIME 嗅探、DENY 防点击劫持、Referrer 收敛防信息泄漏
# CSP 对纯 API 响应收紧为 default-src 'none'（前端文档的安全头由 nginx 配置）
@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'"
    return response


@app.post("/login")
async def login(body: LoginRequest, response: Response):
    user = await db.get_user_by_username(body.username)
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    # token 写入 HttpOnly cookie，响应体不再返回 token
    set_session_cookie(response, create_token(user["id"]))
    return {"username": user["username"]}


@app.post("/logout")
async def logout(response: Response):
    clear_session_cookie(response)
    return {"ok": True}


# 当前用户的会话列表（侧栏）
@app.get("/conversations")
async def list_conversations(user_id: int = Depends(get_current_user_id)):
    return await db.list_conversations(user_id)


@app.get("/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: uuid.UUID,
    limit: int | None = None,
    before_id: str | None = None,
    user_id: int = Depends(get_current_user_id),
):
    conv = await db.get_conversation(user_id, conversation_id, limit=limit, before_id=before_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return conv


@app.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: uuid.UUID, user_id: int = Depends(get_current_user_id)):
    deleted = await db.delete_conversation(user_id, conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="会话不存在")
    return {"ok": True}


def _branch_history(
    messages: list[dict], fork_id: str | None, retry: bool
) -> tuple[list[dict], str | None]:
    """从 fork_id 沿 parent 链上溯到根，返回 (链, 重试问题文本)。

    新轮：fork_id = 新 user 消息的父（不传则链尾），链含链尾，重试文本为 None；
    重试：fork_id = 被重试 assistant 的父（user 节点），链不含该 user（其 content 即重试文本）。
    旧数据无 id 时树退化为线性链，按线序同样可用。"""
    source = {m["id"]: m for m in messages if m.get("id")}
    parent_id = fork_id
    chain: list[dict] = []
    while parent_id is not None:
        node = source.get(parent_id)
        if node is None:
            break
        chain.append(node)
        parent_id = node.get("parent_id")
    chain.reverse()
    if retry:
        # 链尾是被重试 assistant 的父（user 节点）——弹出作为重试问题文本
        user_node = chain.pop() if chain else None
        return chain, user_node["content"] if user_node else None
    return chain, None


@app.post("/chat/completions")
async def chat_completions(
    chat_request: ChatRequest, user_id: int = Depends(get_current_user_id)
) -> StreamingResponse:
    # 会话定位（id 由前端生成随请求携带）：已存在 → 校验归属取历史；
    # 不存在 → 以此 id 落库新建（乐观导航的前提：首请求即确定会话 id，无需等 meta 下发）
    conv = await db.get_conversation(user_id, chat_request.conversation_id)
    if conv is None:
        try:
            await db.create_conversation(user_id, chat_request.prompt[:20], chat_request.conversation_id)
        except UniqueViolationError:
            # id 已被他人会话占用：等同不存在，不泄露会话存在性
            raise HTTPException(status_code=404, detail="会话不存在") from None
        conversation_id = chat_request.conversation_id
        messages: list[dict] = []
    else:
        conversation_id = conv["id"]
        messages = conv["messages"]

    # 分支挂点：新轮 = 链尾；重试必须显式指向某个 user 节点
    fork_id = str(chat_request.parent_message_id) if chat_request.parent_message_id else None
    if fork_id is None and messages:
        # 新轮未显式传挂点：挂到时间序最新的节点（链尾）
        fork_id = messages[-1].get("id")
    if chat_request.retry:
        if fork_id is None:
            raise HTTPException(status_code=400, detail="重试缺少 parent_message_id")
        fork_node = next((m for m in messages if m.get("id") == fork_id), None)
        if fork_node is None or fork_node.get("role") != "user":
            raise HTTPException(status_code=400, detail="重试挂点不存在或不是 user 节点")

    # 上下文按分支父链取（重试时返回被重试的 user 内容作为问题文本）
    history, retry_prompt = _branch_history(messages, fork_id, chat_request.retry)

    # 新树节点 id：只在会话 JSONB 内部被 parent_id 引用，uuid4 保证唯一即可（无序、不暴露 URL）
    user_node_id = uuid.uuid4()
    assistant_node_id = uuid.uuid4()

    # 标题生成判定：新会话（标题=首条 prompt 前 20 字兜底值）时首轮结束后由 LLM 重新生成
    generate_title = conv is None or conv["title"] == chat_request.prompt[:20]

    # 生成任务与 HTTP 连接解耦：后台跑模型写事件缓冲，本请求只作为第一个订阅者。
    # 连接断开（网络抖动/切后台）任务继续存活，客户端凭 task_id 走 /chat/resume 续传
    task = StreamTask(str(assistant_node_id), user_id)
    task.events.append((0, {
        "seq": 0,
        "conversation_id": str(conversation_id),
        "user_message_id": str(user_node_id) if not chat_request.retry else None,
        "assistant_message_id": str(assistant_node_id),
        "parent_message_id": fork_id,
    }))
    TASKS[task.id] = task
    task.gen_task = asyncio.create_task(_run_generation(
        task,
        conversation_id=conversation_id,
        prompt=retry_prompt or chat_request.prompt,
        persist_user=not chat_request.retry,
        user_node_id=user_node_id,
        assistant_node_id=assistant_node_id,
        fork_id=fork_id,
        history=history,
        user_id=user_id,
        generate_title=generate_title,
    ))

    # 首次连接从 seq 0（meta）开始订阅
    return _sse_response(event_subscriber(task, after_seq=-1))


# 断线续传：按 after_seq 从事件缓冲补发并继续跟随，直到任务终态
@app.get("/chat/resume/{task_id}")
async def chat_resume(
    task_id: str,
    after_seq: int = -1,
    user_id: int = Depends(get_current_user_id),
) -> StreamingResponse:
    task = TASKS.get(task_id)
    # 不存在 = 服务重启丢失 / 宽限取消后清理 /  retention 过期：客户端按流失败处理
    if task is None or task.user_id != user_id:
        raise HTTPException(status_code=404, detail="生成任务不存在或已过期")
    return _sse_response(event_subscriber(task, max(after_seq, -1)))


# 用户主动停止：立即取消后台生成（finally 负责半截内容落库）；幂等
@app.post("/chat/cancel/{task_id}")
async def chat_cancel(
    task_id: str, user_id: int = Depends(get_current_user_id)
):
    task = TASKS.get(task_id)
    if task is None or task.user_id != user_id:
        raise HTTPException(status_code=404, detail="生成任务不存在")
    if not task.done and task.gen_task is not None:
        task.gen_task.cancel()
    return {"ok": True}
