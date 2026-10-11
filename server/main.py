import json
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.responses import StreamingResponse

import db
from auth import (
    clear_session_cookie,
    create_token,
    get_current_user_id,
    set_session_cookie,
    verify_password,
)
from content_filter import match_banned
from llm import stream_chat
from schemas import ChatRequest, LoginRequest


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.init()
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
async def get_conversation(conversation_id: uuid.UUID, user_id: int = Depends(get_current_user_id)):
    conv = await db.get_conversation(user_id, conversation_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="会话不存在")
    return conv


@app.delete("/conversations/{conversation_id}")
async def delete_conversation(conversation_id: uuid.UUID, user_id: int = Depends(get_current_user_id)):
    deleted = await db.delete_conversation(user_id, conversation_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="会话不存在")
    return {"ok": True}


@app.post("/chat/completions")
async def chat_completions(
    chat_request: ChatRequest, user_id: int = Depends(get_current_user_id)
) -> StreamingResponse:
    # 输入违禁检查：命中直接下发 content_filter，不建会话不落库
    if match_banned(chat_request.prompt):
        async def rejected() -> AsyncGenerator[str, None]:
            yield json.dumps({"finish_reason": "content_filter"}, ensure_ascii=False) + "\n"

        return StreamingResponse(rejected(), media_type="text/event-stream")

    # 会话归属：带 id 校验属于当前用户，否则以提问前 20 字为标题新建
    if chat_request.conversation_id is not None:
        conv = await db.get_conversation(user_id, chat_request.conversation_id)
        if conv is None:
            raise HTTPException(status_code=404, detail="会话不存在")
        conversation_id = conv["id"]
        history: list[dict] = conv["messages"]
    else:
        conversation_id = await db.create_conversation(user_id, chat_request.prompt[:20])
        history = []

    # 逐事件转 SSE 行（每行一个 JSON）；result 汇总事件不透传，聚合文本追加进会话消息
    async def generate() -> AsyncGenerator[str, None]:
        reasoning = ""
        content = ""
        saved = False

        async def persist() -> None:
            nonlocal saved
            if saved or not (content or reasoning):
                return
            saved = True
            await db.append_messages(conversation_id, [
                {"role": "user", "content": chat_request.prompt},
                {"role": "assistant", "content": content, "reasoning": reasoning},
            ])

        try:
            # 首事件下发会话 id（前端据此关联流式记录与侧栏会话）
            yield json.dumps({"conversation_id": str(conversation_id)}) + "\n"
            async for event in stream_chat(history, chat_request.prompt):
                if event.get("type") == "result":
                    # 正常完成：以汇总事件为准（输出过滤后只含确认安全的部分）
                    reasoning = event["reasoning_content"]
                    content = event["content"]
                    continue
                # 中途累积（客户端中断时汇总事件不会产出，靠这里兜底）
                reasoning += event.get("reasoning_content", "")
                content += event.get("content", "")
                yield json.dumps(event, ensure_ascii=False) + "\n"
            await persist()
        finally:
            # 客户端中断（停止生成/断连）触发 aclose，保存已生成内容
            await persist()

    return StreamingResponse(generate(), media_type="text/event-stream")
