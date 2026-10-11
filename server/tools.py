from datetime import datetime

# 注册给模型的工具（OpenAI function calling 协议）
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_current_time",
            "description": "获取当前的日期和时间",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    }
]


def execute_tool(name: str, arguments: str) -> dict:
    if name == "get_current_time":
        return {"current_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
    raise ValueError(f"未知工具: {name}")
