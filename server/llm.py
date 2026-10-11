import json
from collections.abc import AsyncGenerator

from openai import AsyncOpenAI

import tools
from config import API_KEY, BASE_URL, MODEL, SYSTEM_PROMPT
from content_filter import match_banned, split_safe_tail


# 系统级安全约束：与违禁词过滤（content_filter.py）形成双保险，
# 前者减少模型产出违禁内容的概率，后者兜底拦住漏网的输出
SAFETY_PROMPT = (
    "安全约束（必须严格遵守）：\n"
    "1. 禁止生成任何违法有害内容，包括暴力恐怖、武器与毒品制作、赌博诈骗等；\n"
    "2. 禁止生成任何可用于攻击应用或系统的代码，例如 XSS 攻击、SQL 注入、命令注入等攻击样例；\n"
    "3. 输出的网页代码必须对用户安全，不得包含 script 标签注入、事件属性注入、窃取 cookie 等行为；\n"
    "4. 用户要求生成上述内容时，直接拒绝并简要说明原因。"
)


def _build_messages(history: list[dict], prompt: str) -> list[dict]:
    return [
        # 存库的 assistant 消息里带 reasoning 字段，拼上下文时只取 role/content
        {"role": "system", "content": f"{SYSTEM_PROMPT}\n\n{SAFETY_PROMPT}"},
        *[{"role": m["role"], "content": m["content"]} for m in history],
        {"role": "user", "content": prompt},
    ]


# 工具循环：模型每轮可能返回文本或 tool_calls，直到 finish_reason == stop 才结束
# 产出 SSE 事件 dict，最后一个事件为 {"type": "result", ...} 汇总本轮完整输出（仅供路由层入库，不透传客户端）
# 输出内容流式过违禁词：命中即截断（不再下发后续文本），由路由层补发 finish_reason=content_filter
async def stream_chat(history: list[dict], prompt: str) -> AsyncGenerator[dict, None]:
    client = AsyncOpenAI(api_key=API_KEY, base_url=BASE_URL)
    messages = _build_messages(history, prompt)

    full_reasoning_content = ""
    # 已确认安全、最终可入库的正文（不含待确认尾巴与被截断部分）
    full_content = ""
    # 待确认尾巴：跨分片违禁词检查，最多扣留最长违禁词长度 - 1 个字符
    pending = ""
    filtered = False

    while True:
        response = await client.chat.completions.create(
            model=MODEL,
            messages=messages,
            tools=tools.TOOLS,
            temperature=0,
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
                pending += content
                if match_banned(pending):
                    # 命中违禁词：立即停止生成，尾巴与后续内容全部丢弃
                    # 提前 break 留下未消费的响应流，显式关闭归还连接
                    filtered = True
                    try:
                        await response.close()
                    except Exception:
                        pass
                    break
                safe, pending = split_safe_tail(pending)
                if safe:
                    full_content += safe
                    yield {"content": safe}

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

        if filtered:
            break

        # 没有工具调用：本轮就是最终回答，收尾后结束
        if finish_reason != "tool_calls" or not tool_calls_acc:
            # 流结束时最后一次全量检查尾巴（此处已到终点，不再有分片拼齐它）
            if match_banned(pending):
                filtered = True
            elif pending:
                full_content += pending
                yield {"content": pending}
            pending = ""
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
                result = tools.execute_tool(acc["name"], acc["arguments"])
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

    if filtered:
        yield {"finish_reason": "content_filter"}

    yield {
        "type": "result",
        "reasoning_content": full_reasoning_content,
        "content": full_content,
    }
