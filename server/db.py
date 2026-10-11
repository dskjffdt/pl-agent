import json
import os
import time
import uuid

import asyncpg

from auth import hash_password
from config import AUTH_PASSWORD, AUTH_USERNAME, DATABASE_URL

# 连接池（应用 lifespan 中初始化）
pool: asyncpg.Pool | None = None


def uuid7() -> uuid.UUID:
    """UUID v7（RFC 9562）：48 位毫秒时间戳前缀 + 随机位。
    时间有序使 B-tree 插入局部性好（对比 v4 随机写放大），且不可枚举（对比自增 id）。
    PG 18 才内置 uuidv7()，这里在应用侧生成，兼容低版本 PG 与 Python(<3.14)。"""
    ts = time.time_ns() // 1_000_000
    rand = os.urandom(10)
    raw = ts.to_bytes(6, "big")
    raw += bytes([0x70 | (rand[0] & 0x0F), rand[1]])  # version 7
    raw += bytes([0x80 | (rand[2] & 0x3F)])  # variant 10xx
    raw += rand[3:10]
    return uuid.UUID(bytes=raw)


async def init() -> None:
    global pool
    pool = await asyncpg.create_pool(DATABASE_URL)
    async with pool.acquire() as conn:
        # 旧版单轮表（prompt/reasoning_content/content 列）与新结构不兼容，直接废弃重建
        legacy = await conn.fetchval(
            "SELECT 1 FROM information_schema.columns"
            " WHERE table_name = 'conversations' AND column_name = 'prompt'"
        )
        if legacy:
            await conn.execute("DROP TABLE conversations")
        # 自增 id 升级为 UUIDv7：旧表结构不兼容，一次性废弃重建
        id_type = await conn.fetchval(
            "SELECT data_type FROM information_schema.columns"
            " WHERE table_name = 'conversations' AND column_name = 'id'"
        )
        if id_type == "integer":
            await conn.execute("DROP TABLE conversations")

        await conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        # 多会话：messages 用 JSONB 存整段会话的平铺消息（user/assistant 相邻配对）；
        # 会话主键 UUIDv7 由应用侧生成
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id UUID PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                title TEXT NOT NULL,
                messages JSONB NOT NULL DEFAULT '[]',
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)

        # 内置账号：首次启动 seed，已存在则跳过（不覆盖用户改过的密码）
        await conn.execute(
            "INSERT INTO users (username, password_hash) VALUES ($1, $2)"
            " ON CONFLICT (username) DO NOTHING",
            AUTH_USERNAME,
            hash_password(AUTH_PASSWORD),
        )


async def close() -> None:
    if pool:
        await pool.close()


async def get_user_by_username(username: str) -> dict | None:
    assert pool is not None, "数据库连接池未初始化"
    row = await pool.fetchrow("SELECT id, username, password_hash FROM users WHERE username = $1", username)
    return dict(row) if row else None


async def list_conversations(user_id: int) -> list[dict]:
    assert pool is not None, "数据库连接池未初始化"
    rows = await pool.fetch(
        "SELECT id, title, updated_at FROM conversations"
        " WHERE user_id = $1 ORDER BY updated_at DESC",
        user_id,
    )
    return [dict(r) for r in rows]


async def get_conversation(user_id: int, conversation_id: uuid.UUID) -> dict | None:
    assert pool is not None, "数据库连接池未初始化"
    row = await pool.fetchrow(
        "SELECT id, user_id, title, messages FROM conversations WHERE id = $1 AND user_id = $2",
        conversation_id,
        user_id,
    )
    if not row:
        return None
    conv = dict(row)
    # asyncpg 默认把 JSONB 读成 str，这里手动解析
    conv["messages"] = json.loads(conv["messages"])
    return conv


async def create_conversation(user_id: int, title: str) -> uuid.UUID:
    assert pool is not None, "数据库连接池未初始化"
    conv_id = uuid7()
    await pool.execute(
        "INSERT INTO conversations (id, user_id, title) VALUES ($1, $2, $3)",
        conv_id,
        user_id,
        title,
    )
    return conv_id


async def append_messages(conversation_id: uuid.UUID, messages: list[dict]) -> None:
    assert pool is not None, "数据库连接池未初始化"
    # jsonb 拼接原子追加，同时刷新 updated_at（侧栏按它倒序）
    await pool.execute(
        "UPDATE conversations"
        " SET messages = messages || $2::jsonb, updated_at = now()"
        " WHERE id = $1",
        conversation_id,
        json.dumps(messages, ensure_ascii=False),
    )


async def delete_conversation(user_id: int, conversation_id: uuid.UUID) -> bool:
    assert pool is not None, "数据库连接池未初始化"
    # user_id 限定归属，防止越权删除他人会话
    tag = await pool.execute(
        "DELETE FROM conversations WHERE id = $1 AND user_id = $2",
        conversation_id,
        user_id,
    )
    return tag == "DELETE 1"
