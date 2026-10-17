from uuid import UUID

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    # 长度上限：防大 payload 攻击（bcrypt 计算成本高，超长密码会拖慢登录接口）
    username: str = Field(max_length=64)
    password: str = Field(max_length=128)


class ChatRequest(BaseModel):
    # 单条提问上限 20000 字，防止超长输入打爆模型与流式响应
    prompt: str = Field(max_length=20000)
    # 归属会话（UUIDv7，字符串随请求发送）：id 由前端生成——已存在则校验归属，不存在则以此 id 新建
    conversation_id: UUID
    # 分支挂点：新轮默认挂链尾；重试时=被重试 assistant 的父节点（user 节点）id
    parent_message_id: UUID | None = None
    # 重试模式：不落库 user 消息，新 assistant 直接挂 parent_message_id 下形成分支
    retry: bool = False
