"""每轮对话结束后的 fire-and-forget 后台任务：长期记忆提取 + 会话标题生成。

不阻塞 SSE 流；任务持有强引用防 GC，异常记日志不外抛。"""

import asyncio
import logging
import uuid

import db
import llm
from config import (
    MEMORY_MAX_COUNT,
    MEMORY_SYSTEM_PROMPT,
    TITLE_MAX_CHARS,
    TITLE_SYSTEM_PROMPT,
)

logger = logging.getLogger(__name__)

# 模块级强引用：create_task 返回的 task 若无人持有可能被 GC 中途取消
_bg_tasks: set[asyncio.Task] = set()


def _on_done(task: asyncio.Task) -> None:
    _bg_tasks.discard(task)
    if not task.cancelled() and (exc := task.exception()):
        logger.error("后台任务失败", exc_info=exc)


def _spawn(coro) -> None:
    task = asyncio.create_task(coro)
    _bg_tasks.add(task)
    task.add_done_callback(_on_done)


def after_turn(
    *,
    conversation_id: uuid.UUID,
    user_id: int,
    prompt: str,
    answer: str,
    generate_title: bool,
) -> None:
    """一轮对话成功落库后触发；answer 传最终正文（为空退化为 reasoning）"""
    _spawn(_extract_memories(user_id, prompt, answer))
    if generate_title:
        _spawn(_generate_title(conversation_id, prompt, answer))


def _clamp_title(raw: str) -> str:
    """纯函数：去引号、取首行、限长；空输入返回空串（调用方据此跳过更新）"""
    stripped = raw.strip()
    if not stripped:
        return ""
    return stripped.strip("\"“”").splitlines()[0][:TITLE_MAX_CHARS].strip()


async def _generate_title(
    conversation_id: uuid.UUID, prompt: str, answer: str
) -> None:
    raw = await llm.complete(
        TITLE_SYSTEM_PROMPT,
        f"用户提问：{prompt}\n\n回答开头：{answer[:500]}",
    )
    title = _clamp_title(raw)
    if title:
        await db.update_conversation_title(conversation_id, title)


async def _extract_memories(user_id: int, prompt: str, answer: str) -> None:
    raw = await llm.complete(
        MEMORY_SYSTEM_PROMPT,
        f"用户：{prompt}\n\n助手：{answer[:2000]}",
    )
    items = []
    for line in raw.splitlines():
        item = line.lstrip("-•· ").strip()
        # 过滤空行、"无"类占位与超长短句
        if 2 <= len(item) <= 200 and item not in {"无", "没有", "无。", "没有。"}:
            items.append(item)
    if items:
        await db.add_user_memories(user_id, items, MEMORY_MAX_COUNT)
