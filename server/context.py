"""上下文组装：token 预算裁剪 + 被裁前缀的摘要解析 + 用户长期记忆读取。

_run_generation 在后台任务内的唯一入口是 build_chat_context；
摘要生成发生在请求路径上（懒生成），绝大多数会话不超预算时零额外 LLM 调用。
"""

import asyncio
import logging
from collections import defaultdict
from dataclasses import dataclass

import db
import llm
import tokenizer
from config import (
    MESSAGE_OVERHEAD_TOKENS,
    SUMMARY_CHUNK_TOKENS,
    SUMMARY_MAX_TOKENS,
    SUMMARY_SYSTEM_PROMPT,
    TOKEN_BUDGET,
)

logger = logging.getLogger(__name__)

# 同一边界节点的摘要并发生成防重（进程内；单 worker 部署）
_summary_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


@dataclass
class ChatContext:
    history: list[dict]   # 裁剪后保留的节点（原 dict 引用，role/content 参与拼上下文）
    summary: str | None   # 被裁前缀摘要，None = 未裁剪
    memories: list[str]   # 用户长期记忆


async def build_chat_context(
    user_id: int, history: list[dict], prompt: str
) -> ChatContext:
    # 空链直通：新会话首轮，零 DB/LLM 开销
    if not history:
        return ChatContext(history=history, summary=None, memories=[])

    memories = await db.get_user_memories(user_id)

    # 同步 Rust 计数入线程池，防阻塞事件循环
    texts = [m["content"] for m in history] + [prompt, llm.system_text(memories)]
    counts = await asyncio.to_thread(tokenizer.estimate_batch, texts)
    hist_counts = counts[: len(history)]
    prompt_tokens, system_tokens = counts[len(history)], counts[-1]
    # 每条消息固定 overhead：history + system + user
    overhead = MESSAGE_OVERHEAD_TOKENS * (len(history) + 2)

    # 原始总量已超预算才在固定开销里预留摘要占位（未超时无摘要、无占位）
    base_total = system_tokens + prompt_tokens + overhead + sum(hist_counts)
    summary_reserve = SUMMARY_MAX_TOKENS if base_total > TOKEN_BUDGET else 0
    fixed = system_tokens + prompt_tokens + overhead + summary_reserve

    k = _cut_count(history, hist_counts, fixed, TOKEN_BUDGET)
    summary = await _resolve_summary(history, k - 1) if k else None
    return ChatContext(history=history[k:], summary=summary, memories=memories)


def _cut_count(
    history: list[dict], counts: list[int], fixed: int, budget: int
) -> int:
    """纯函数：从队头按整对裁剪（user+assistant 为一对），返回裁掉的节点数（0=预算内）。

    链形异常（队头 assistant、结尾落单 user、上轮失败产生的连续 user）按 1 个裁；
    全裁仍超预算时返回 len(history)——prompt 巨于预算属极端，交给 API 报错。"""
    total = fixed + sum(counts)
    if total <= budget:
        return 0
    i, n = 0, len(history)
    while i < n and total > budget:
        step = 2 if history[i]["role"] == "user" and i + 1 < n else 1
        total -= sum(counts[i : i + step])
        i += step
    return i


async def _resolve_summary(chain: list[dict], upto: int) -> str | None:
    """chain[0..upto]（含）的链前缀摘要：缓存命中直取；否则加锁双检后生成。

    生成失败记日志返回 None——本轮退化为无摘要继续对话，缓存未写下次重试。"""
    node_id = chain[upto]["id"]
    cached = await db.get_node_summary(node_id)
    if cached:
        return cached
    async with _summary_locks[node_id]:
        cached = await db.get_node_summary(node_id)  # 双检：等锁期间可能已被并发写入
        if cached:
            return cached
        try:
            text = await _compose_summary(chain, upto)
            await db.save_node_summary(node_id, text)
            return text
        except Exception:
            logger.exception("生成节点摘要失败 node_id=%s", node_id)
            return None


async def _compose_summary(chain: list[dict], upto: int) -> str:
    """摘要合成摘要：优先复用最近已缓存祖先的摘要，只把增量段滚动合并进去。

    无任何祖先缓存且增量段过大时（如缩小预算后旧会话首次越界）按 token 贪心分块。"""
    cached = await db.get_node_summaries([m["id"] for m in chain[:upto]])
    j = max((i for i in range(upto) if chain[i]["id"] in cached), default=-1)
    prev = cached[chain[j]["id"]] if j >= 0 else None
    seg = chain[j + 1 : upto + 1]

    seg_counts = await asyncio.to_thread(
        tokenizer.estimate_batch, [m["content"] for m in seg]
    )
    for chunk in _chunk_nodes(seg, seg_counts, SUMMARY_CHUNK_TOKENS):
        transcript = "\n".join(
            f"{'用户' if m['role'] == 'user' else '助手'}：{m['content']}" for m in chunk
        )
        user = (
            f"已有摘要：\n{prev}\n\n请将其与下面新增内容合并为一份更完整的摘要：\n{transcript}"
            if prev
            else f"请摘要以下对话：\n{transcript}"
        )
        prev = await llm.complete(SUMMARY_SYSTEM_PROMPT, user)
    return prev


def _chunk_nodes(
    nodes: list[dict], counts: list[int], limit: int
) -> list[list[dict]]:
    """纯函数：按 token 贪心分块，单条超限的自行成块"""
    chunks: list[list[dict]] = []
    cur: list[dict] = []
    cur_tokens = 0
    for node, tokens in zip(nodes, counts):
        if cur and cur_tokens + tokens > limit:
            chunks.append(cur)
            cur, cur_tokens = [], 0
        cur.append(node)
        cur_tokens += tokens
    if cur:
        chunks.append(cur)
    return chunks
