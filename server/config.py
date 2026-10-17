import os
from pathlib import Path

import dotenv

dotenv.load_dotenv()

# DeepSeek
API_KEY = os.getenv("DEEPSEEK_API_KEY")
BASE_URL = os.getenv("DEEPSEEK_API_BASE_URL")
MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")
SYSTEM_PROMPT = os.getenv(
    "SYSTEM_PROMPT",
    "你是一位资深软件工程师，精通主流编程语言、系统设计与工程实践，"
    "以专业、严谨、可落地的方式解答用户的技术问题。"
    "所有输出必须全部使用中文，包括思考与推理过程（代码、命令、专有名词保持原样）。",
)

# PostgreSQL 连接串（docker compose 起 db 或本机 Postgres）
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/plagent",
)

# JWT 认证（生产环境务必通过环境变量覆盖默认密钥，HS256 要求密钥 ≥ 32 字节）
JWT_SECRET = os.getenv("JWT_SECRET", "I4MMBFNL3yGRD0JVG0tMNS1Ba3K4Uno151XQmXKIYTBcRVtNKkD7o03BcGs0FU9p")
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "72"))

# Cookie 安全属性：https 部署时设 COOKIE_SECURE=true（浏览器只在 https 下携带）
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"

# 内置账号：首次启动 seed 进 users 表（用户名/密码可用环境变量覆盖）
AUTH_USERNAME = os.getenv("AUTH_USERNAME", "admin")
AUTH_PASSWORD = os.getenv("AUTH_PASSWORD", "admin123")

# ---- Token 预算 ----
# 上下文窗口与最大输出（老项目口径：1M / 100k），输入预算再留 5% 余量
CONTEXT_SIZE = int(os.getenv("CONTEXT_SIZE", "1000000"))
MAX_OUTPUT_TOKENS = int(os.getenv("MAX_OUTPUT_TOKENS", "100000"))
TOKEN_BUDGET = int(os.getenv("TOKEN_BUDGET") or (CONTEXT_SIZE - MAX_OUTPUT_TOKENS) * 0.95)
# DeepSeek 官方 tokenizer（tokenizers 库直调；缺失/不兼容启动即红，禁止字符估算回退）
TOKENIZER_PATH = os.getenv("TOKENIZER_PATH", str(Path(__file__).resolve().parent / "tokenizer.json"))
# 每条消息的 ChatML role/分隔符固定开销
MESSAGE_OVERHEAD_TOKENS = 4
# 重复文本计数缓存条数
TOKEN_CACHE_SIZE = 8192

# ---- 摘要记忆 ----
# 摘要长度上限，同时在预算中作为占位预留
SUMMARY_MAX_TOKENS = int(os.getenv("SUMMARY_MAX_TOKENS", "1024"))
# 滚动摘要单块输入的 token 上限（超限分块合并）
SUMMARY_CHUNK_TOKENS = int(os.getenv("SUMMARY_CHUNK_TOKENS", "200000"))
SUMMARY_SYSTEM_PROMPT = os.getenv(
    "SUMMARY_SYSTEM_PROMPT",
    "你是对话摘要助手。把对话内容压缩为一段中文摘要，"
    "保留用户诉求、关键决定、技术细节与未完成事项。只输出摘要正文。",
)

# ---- 长期记忆 ----
# 每用户记忆条数封顶（超限删最旧）
MEMORY_MAX_COUNT = int(os.getenv("MEMORY_MAX_COUNT", "50"))
MEMORY_SYSTEM_PROMPT = os.getenv(
    "MEMORY_SYSTEM_PROMPT",
    "从这轮对话提取用户的持久偏好与事实（技术栈、工作习惯、长期约束等），"
    "每行一条短句，不带序号。没有可提取内容时只输出：无。不要提取一次性任务细节。",
)

# ---- 会话标题 ----
TITLE_MAX_CHARS = int(os.getenv("TITLE_MAX_CHARS", "16"))
TITLE_SYSTEM_PROMPT = os.getenv(
    "TITLE_SYSTEM_PROMPT",
    "为以下对话生成一个不超过16字的中文标题，概括核心主题。只输出标题本身，不要引号标点。",
)
