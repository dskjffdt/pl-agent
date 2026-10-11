# 违禁词库：违法内容 + 可能攻击应用的代码片段（命中即拒绝输入 / 截断输出）
# 输出过滤用大小写不敏感匹配，攻击片段（如 <script）大小写变体都能拦住
BANNED_WORDS = [
    # 违法内容（覆盖常见中文语序变体，如「制作毒品/毒品制作」两种说法都能命中）
    "制作毒品", "毒品制作", "做毒品", "制毒方法", "贩毒", "运毒",
    "制造炸弹", "炸弹制作", "做炸弹", "自制炸药", "爆炸装置",
    "自制枪支", "仿制枪支", "枪支改装", "制毒教程", "冰毒", "海洛因",
    "摇头丸", "自杀教程", "自杀方法", "杀人方法",
    # 攻击性代码（XSS / 注入 / 危险命令），大小写不敏感匹配
    "<script", "<img onerror", "javascript:", "onerror=", "onload=",
    "document.cookie", "eval(", "or 1=1", "drop table", "union select",
    "delete from", "insert into", "rm -rf", "../etc/passwd",
    "木马程序", "病毒代码", "攻击脚本", "入侵教程", "ddos攻击", "钓鱼网站搭建",
]

_LOWERED = [w.lower() for w in BANNED_WORDS]
# 流式过滤时正文需要扣留的尾巴长度：跨分片的违禁词最长可能差 1 个字符拼齐
_MAX_WORD_LEN = max(len(w) for w in _LOWERED)
_TAIL_LEN = _MAX_WORD_LEN - 1


def match_banned(text: str) -> str | None:
    """返回命中的违禁词，未命中返回 None"""
    lowered = text.lower()
    for word in _LOWERED:
        if word in lowered:
            return word
    return None


def split_safe_tail(text: str) -> tuple[str, str]:
    """把一段文本切成（可安全下发的前缀，待确认的尾巴）：
    尾巴保留最长违禁词长度 - 1 个字符，避免违禁词跨分片拼接时漏检"""
    if len(text) <= _TAIL_LEN:
        return "", text
    cut = len(text) - _TAIL_LEN
    return text[:cut], text[cut:]
