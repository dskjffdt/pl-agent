from functools import lru_cache

from config import TOKEN_CACHE_SIZE, TOKENIZER_PATH

_TOKENIZER = None


def _get_tokenizer():
    global _TOKENIZER
    if _TOKENIZER is not None:
        return _TOKENIZER
    # 懒加载 + 显式失败：文件缺失/格式不兼容直接 RuntimeError，
    # 绝不静默回退字符估算（估算偏差会让预算裁剪形同虚设）
    try:
        from tokenizers import Tokenizer

        tok = Tokenizer.from_file(TOKENIZER_PATH)
        # 兼容性自检：中文 + 英文 + 数字各来一点，encode 异常即视为词表不兼容
        tok.encode("兼容性自检 self-check 123", add_special_tokens=False)
    except Exception as e:
        raise RuntimeError(
            f"tokenizer 加载失败（path={TOKENIZER_PATH}）：{e}。"
            "请确认 server/tokenizer.json 存在且与 tokenizers 库兼容，禁止回退字符估算。"
        ) from e
    _TOKENIZER = tok
    return tok


@lru_cache(maxsize=TOKEN_CACHE_SIZE)
def estimate_tokens(text: str) -> int:
    # add_special_tokens=False：BOS/EOS 由调用方按消息 overhead 统一计，不重复算
    return len(_get_tokenizer().encode(text, add_special_tokens=False).ids)


def estimate_batch(texts: list[str]) -> list[int]:
    """批量计数（供 asyncio.to_thread 包裹，同步 Rust 调用不阻塞事件循环）"""
    return [estimate_tokens(t) for t in texts]


def warmup() -> None:
    """启动自检：首次计数失败直接拒绝启动，避免运行期才发现 tokenizer 不可用"""
    estimate_tokens("启动自检")
