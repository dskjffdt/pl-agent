import asyncio
import json
from collections.abc import AsyncGenerator

from openai import AsyncOpenAI

import tools
from config import API_KEY, BASE_URL, MODEL, SYSTEM_PROMPT


# 系统级安全约束：提示词层面禁止模型产出违法内容与攻击代码
SAFETY_PROMPT = (
    "安全约束（必须严格遵守）：\n"
    "1. 禁止生成任何违法有害内容，包括暴力恐怖、武器与毒品制作、赌博诈骗等；\n"
    "2. 禁止生成任何可用于攻击应用或系统的代码，例如 XSS 攻击、SQL 注入、命令注入等攻击样例；\n"
    "3. 输出的网页代码必须对用户安全，不得包含 script 标签注入、事件属性注入、窃取 cookie 等行为；\n"
    "4. 用户要求生成上述内容时，直接拒绝并简要说明原因。"
)

# 工具循环熔断：模型异常反复请求工具（或工具结果无法让它收敛）时，
# 最多执行 N 轮工具调用，超过后强制收尾，防 while True 空转烧 token
MAX_TOOL_ROUNDS = 5


# 上下文裁剪已由 context.py 按 token 预算精确处理（含摘要注入），
# 这里只负责拼装：system（含记忆/摘要）+ 历史 + 本轮提问
def _build_messages(
    history: list[dict],
    prompt: str,
    *,
    prefix_summary: str | None = None,
    memories: list[str] | None = None,
) -> list[dict]:
    return [
        # 存库的 assistant 消息里带 reasoning 字段，拼上下文时只取 role/content
        {"role": "system", "content": system_text(memories, prefix_summary)},
        *[{"role": m["role"], "content": m["content"]} for m in history],
        {"role": "user", "content": prompt},
    ]


def system_text(memories: list[str] | None = None, summary: str | None = None) -> str:
    """system 消息拼装（context.py 计数复用同一函数，避免两处拼串漂移）"""
    text = f"{SYSTEM_PROMPT}\n\n{SAFETY_PROMPT}"
    if memories:
        text += "\n\n[用户长期记忆]\n" + "\n".join(f"- {m}" for m in memories)
    if summary:
        text += f"\n\n[早期对话摘要]\n{summary}"
    return text


# 懒加载单例：全进程共用连接池，避免每请求新建客户端的低效与泄漏
_client: AsyncOpenAI | None = None


def _get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(api_key=API_KEY, base_url=BASE_URL)
    return _client


async def complete(system: str, user: str) -> str:
    """非流式单轮补全（摘要生成/记忆提取/标题生成三处共用的公共 helper）"""
    resp = await _get_client().chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return resp.choices[0].message.content or ""


# 工具循环：模型每轮可能返回文本或 tool_calls，直到 finish_reason == stop 才结束
# 产出 SSE 事件 dict，最后一个事件为 {"type": "result", ...} 汇总本轮完整输出（仅供路由层入库，不透传客户端）
async def stream_chat(
    history: list[dict],
    prompt: str,
    *,
    prefix_summary: str | None = None,
    memories: list[str] | None = None,
) -> AsyncGenerator[dict, None]:
    client = _get_client()
    messages = _build_messages(history, prompt, prefix_summary=prefix_summary, memories=memories)

    full_reasoning_content = ""
    # 本轮完整正文（流式累计，供 result 汇总事件入库）
    full_content = ""
    # 已执行的工具轮数（每请求一批工具算一轮）
    tool_rounds = 0

    while True:
        response = await client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools=tools.TOOLS,
            temperature=2,
            stream=True,
        )

        assistant_content = ""
        # 流式 tool_calls 分片聚合：index -> {id, name, arguments}
        tool_calls_acc: dict[int, dict] = {}
        finish_reason = None

        async for chunk in response:
            msg = chunk.choices[0]
            delta = msg.delta

            # 带 tools 后部分 delta 不含这些字段，用 getattr 兜底避免 AttributeError
            reasoning = getattr(delta, "reasoning_content", None)
            if reasoning:
                full_reasoning_content += reasoning
                yield {"reasoning_content": reasoning}
            content = getattr(delta, "content", None)
            if content:
                assistant_content += content
                full_content += content
                yield {"content": content}

            # tool_calls 分片到达，按 index 拼装完整调用
            for tc in getattr(delta, "tool_calls", None) or []:
                acc = tool_calls_acc.setdefault(
                    tc.index, {"id": "", "name": "", "arguments": ""}
                )
                if tc.id:
                    acc["id"] = tc.id
                if tc.function and tc.function.name:
                    acc["name"] = tc.function.name
                if tc.function and tc.function.arguments:
                    acc["arguments"] += tc.function.arguments

            if msg.finish_reason:
                finish_reason = msg.finish_reason

        # 没有工具调用：本轮就是最终回答，收尾后结束
        if finish_reason != "tool_calls" or not tool_calls_acc:
            break

        # 熔断判定在执行工具之前：已执行满 MAX_TOOL_ROUNDS 轮模型仍请求工具，
        # 下发可见终止提示并收尾（提示计入 full_content，随 result 落库），防空转烧 token
        tool_rounds += 1
        if tool_rounds > MAX_TOOL_ROUNDS:
            notice = f"\n\n（已连续执行 {MAX_TOOL_ROUNDS} 轮工具调用仍未收敛，为防止异常循环已自动终止）"
            full_content += notice
            yield {"content": notice}
            break

        # 组装含完整 tool_calls 的 assistant 消息，按协议回传给模型
        ordered_calls = [acc for _, acc in sorted(tool_calls_acc.items())]
        messages.append({
            "role": "assistant",
            "content": assistant_content or None,
            "tool_calls": [
                {
                    "id": acc["id"],
                    "type": "function",
                    "function": {"name": acc["name"], "arguments": acc["arguments"]},
                }
                for acc in ordered_calls
            ],
        })

        # 逐个执行工具：先推 tool_start，执行完推 tool_end，结果喂回模型继续下一轮
        for acc in ordered_calls:
            yield {"type": "tool_start", "id": acc["id"], "name": acc["name"]}
            try:
                # to_thread 防止 I/O 类工具阻塞事件循环（当前工具是纯 CPU 微秒级，开销可忽略）
                result = await asyncio.to_thread(tools.execute_tool, acc["name"], acc["arguments"])
                status = "done"
            except Exception as e:
                result = {"error": str(e)}
                status = "error"
            yield {"type": "tool_end", "id": acc["id"], "name": acc["name"], "status": status}
            messages.append({
                "role": "tool",
                "tool_call_id": acc["id"],
                "content": json.dumps(result, ensure_ascii=False),
            })

    yield {
        "type": "result",
        "reasoning_content": full_reasoning_content,
        "content": full_content,
    }
