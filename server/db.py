import json
import uuid

import asyncpg

from auth import hash_password
from config import AUTH_PASSWORD, AUTH_USERNAME, DATABASE_URL

# 连接池（应用 lifespan 中初始化）
pool: asyncpg.Pool | None = None


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
        # 自增 integer 主键升级为 UUID：旧表结构不兼容，一次性废弃重建
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
        # 会话主键 UUID 由前端生成（UUIDv7：时间有序、不可枚举），此处只声明列类型
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

        # 摘要记忆：按消息节点缓存"截至该节点（含）的链前缀摘要"；节点内容不可变 → 缓存永不失效
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS node_summaries (
                node_id TEXT PRIMARY KEY,
                summary TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)

        # 长期记忆：跨会话的用户持久偏好/事实；content_norm 为归一化去重键
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS user_memories (
                id BIGSERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                content TEXT NOT NULL,
                content_norm TEXT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (user_id, content_norm)
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


async def get_conversation(
    user_id: int,
    conversation_id: uuid.UUID,
    limit: int | None = None,
    before_id: str | None = None,
) -> dict | None:
    """获取会话消息，支持分页。

    - 不传参数：返回全部消息（保持兼容）
    - 传 limit：返回最新 limit 条
    - 传 before_id + limit：返回 before_id 节点之前的 limit 条（向上翻页）
    返回 dict 含 has_more 表示是否还有更早的消息。
    """
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
    msgs = json.loads(conv["messages"])
    # 会话树：旧数据无 node id，按线序补成父链（前端统一按树消费）；
    # 补出的 id 必须回写固化——否则每次读随机生成，前端重试时按上次 id 定位会落空
    touched = False
    prev_id = None
    for m in msgs:
        if "id" not in m:
            m["id"] = str(uuid.uuid4())
            m["parent_id"] = prev_id
            touched = True
        prev_id = m["id"]
    if touched:
        await pool.execute(
            "UPDATE conversations SET messages = $2::jsonb WHERE id = $1",
            conversation_id,
            json.dumps(msgs, ensure_ascii=False),
        )

    total = len(msgs)
    if limit is not None and limit > 0:
        if before_id is not None:
            # 向上翻页：找到 before_id 节点的索引，取其之前的 limit 条
            before_idx = next((i for i, m in enumerate(msgs) if m.get("id") == before_id), 0)
            start = max(0, before_idx - limit)
            msgs = msgs[start:before_idx]
        else:
            # 首次加载：取最新 limit 条
            msgs = msgs[-limit:]
        conv["has_more"] = len(msgs) < total and (before_id is not None or total > limit)
    else:
        conv["has_more"] = False

    conv["messages"] = msgs
    return conv


async def create_conversation(user_id: int, title: str, conv_id: uuid.UUID) -> uuid.UUID:
    """以调用方传入的会话 id（前端生成的 UUIDv7）落库；id 已被占用时抛唯一约束异常"""
    assert pool is not None, "数据库连接池未初始化"
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
    # 删除前先取节点 id 清理摘要缓存，防孤儿累积
    row = await pool.fetchrow(
        "SELECT messages FROM conversations WHERE id = $1 AND user_id = $2",
        conversation_id,
        user_id,
    )
    if not row:
        return False
    node_ids = [m["id"] for m in json.loads(row["messages"]) if m.get("id")]
    if node_ids:
        await pool.execute("DELETE FROM node_summaries WHERE node_id = ANY($1)", node_ids)
    await pool.execute(
        "DELETE FROM conversations WHERE id = $1 AND user_id = $2",
        conversation_id,
        user_id,
    )
    return True


# ---- 摘要缓存（node_summaries） ----

async def get_node_summary(node_id: str) -> str | None:
    assert pool is not None, "数据库连接池未初始化"
    row = await pool.fetchrow("SELECT summary FROM node_summaries WHERE node_id = $1", node_id)
    return row["summary"] if row else None


async def get_node_summaries(node_ids: list[str]) -> dict[str, str]:
    assert pool is not None, "数据库连接池未初始化"
    rows = await pool.fetch("SELECT node_id, summary FROM node_summaries WHERE node_id = ANY($1)", node_ids)
    return {r["node_id"]: r["summary"] for r in rows}


async def save_node_summary(node_id: str, summary: str) -> None:
    assert pool is not None, "数据库连接池未初始化"
    # 先写者赢：并发对同一边界生成时，唯一约束保证只落一份
    await pool.execute(
        "INSERT INTO node_summaries (node_id, summary) VALUES ($1, $2) ON CONFLICT (node_id) DO NOTHING",
        node_id,
        summary,
    )


# ---- 长期记忆（user_memories） ----

async def get_user_memories(user_id: int) -> list[str]:
    assert pool is not None, "数据库连接池未初始化"
    rows = await pool.fetch(
        "SELECT content FROM user_memories WHERE user_id = $1 ORDER BY created_at DESC",
        user_id,
    )
    return [r["content"] for r in rows]


async def add_user_memories(user_id: int, memories: list[str], max_count: int) -> None:
    assert pool is not None, "数据库连接池未初始化"
    # 归一化（折叠空白 + lower）作精确去重键；重复表述命中唯一约束直接跳过
    for m in memories:
        norm = " ".join(m.split()).lower()
        await pool.execute(
            "INSERT INTO user_memories (user_id, content, content_norm) VALUES ($1, $2, $3)"
            " ON CONFLICT (user_id, content_norm) DO NOTHING",
            user_id,
            m,
            norm,
        )
    # 封顶：只留最近 max_count 条（同秒按 id 决胜）
    await pool.execute(
        "DELETE FROM user_memories WHERE user_id = $1 AND id NOT IN ("
        " SELECT id FROM user_memories WHERE user_id = $1"
        " ORDER BY created_at DESC, id DESC LIMIT $2)",
        user_id,
        max_count,
    )


# ---- 会话标题 ----

async def update_conversation_title(conversation_id: uuid.UUID, title: str) -> None:
    assert pool is not None, "数据库连接池未初始化"
    await pool.execute(
        "UPDATE conversations SET title = $2 WHERE id = $1",
        conversation_id,
        title,
    )
