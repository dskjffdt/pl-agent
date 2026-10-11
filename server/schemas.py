from uuid import UUID

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    # 长度上限：防大 payload 攻击（bcrypt 计算成本高，超长密码会拖慢登录接口）
    username: str = Field(max_length=64)
    password: str = Field(max_length=128)


class ChatRequest(BaseModel):
    # 单条提问上限 20000 字，防止超长输入打爆模型与流式响应
    prompt: str = Field(max_length=20000)
    # 归属会话（UUIDv7，字符串随请求发送）：为空则新建会话
    conversation_id: UUID | None = None
