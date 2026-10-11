import os

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

# JWT 认证（生产环境务必通过环境变量覆盖默认密钥）
JWT_SECRET = os.getenv("JWT_SECRET", "plagent-dev-secret-change-me")
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "72"))

# Cookie 安全属性：https 部署时设 COOKIE_SECURE=true（浏览器只在 https 下携带）
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").lower() == "true"

# 内置账号：首次启动 seed 进 users 表（用户名/密码可用环境变量覆盖）
AUTH_USERNAME = os.getenv("AUTH_USERNAME", "admin")
AUTH_PASSWORD = os.getenv("AUTH_PASSWORD", "admin123")
