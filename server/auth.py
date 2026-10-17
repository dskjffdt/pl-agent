import time

import bcrypt
import jwt
from fastapi import HTTPException, Request

from config import COOKIE_SECURE, JWT_EXPIRE_HOURS, JWT_SECRET

# 会话 cookie 名（HttpOnly，前端 JS 读不到，防 XSS 窃取 token）
SESSION_COOKIE = "plagent_token"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_token(user_id: int) -> str:
    payload = {"sub": str(user_id), "exp": int(time.time()) + JWT_EXPIRE_HOURS * 3600}
    return jwt.encode(payload, JWT_SECRET, algorithm="HS256")


def set_session_cookie(response, token: str) -> None:
    # HttpOnly 防 XSS 窃取；SameSite=Lax 下跨站 POST/fetch 不携带 cookie，挡住 CSRF
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=JWT_EXPIRE_HOURS * 3600,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        path="/",
    )


def clear_session_cookie(response) -> None:
    # 删除指令的属性与 set_session_cookie 保持一致：Secure cookie 在部分浏览器上
    # 要求删除指令同样带 Secure，否则旧 cookie 可能残留
    response.delete_cookie(
        key=SESSION_COOKIE,
        path="/",
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
    )


# 路由依赖：从 HttpOnly cookie 取 token 校验，通过后返回 user_id
def get_current_user_id(request: Request) -> int:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="未登录")
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
    return int(payload["sub"])
