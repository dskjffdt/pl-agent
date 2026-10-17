"""纯函数用例：整对裁剪逻辑（_cut_count）与标题钳制（_clamp_title）。

不碰 DB / LLM / tokenizer——counts 直接构造传入。"""

from context import _cut_count
from jobs import _clamp_title


def node(role: str, tokens: int, idx: int) -> dict:
    return {"id": f"n{idx}", "role": role, "content": "x" * tokens}


def chain(roles: list[str], counts: list[int]) -> tuple[list[dict], list[int]]:
    return (
        [node(r, c, i) for i, (r, c) in enumerate(zip(roles, counts))],
        counts,
    )


def test_within_budget_no_cut():
    history, counts = chain(["user", "assistant"], [10, 20])
    assert _cut_count(history, counts, fixed=30, budget=100) == 0


def test_cut_whole_pairs_from_head():
    # 固定开销 40 + 全部 200 = 240 > 预算 170：裁掉头一对（30+50）后 160 ≤ 170，只裁 2 个
    history, counts = chain(
        ["user", "assistant", "user", "assistant"], [30, 50, 40, 80]
    )
    assert _cut_count(history, counts, fixed=40, budget=170) == 2


def test_odd_tail_cuts_single():
    # 链尾落单 user（上轮 assistant 未落库）：正常链裁整对，头一对裁掉后 20+100=120 恰好达标
    history, counts = chain(
        ["user", "assistant", "user", "user"], [50, 50, 40, 40]
    )
    assert _cut_count(history, counts, fixed=20, budget=120) == 2


def test_leading_assistant_cuts_single():
    # 队头 assistant（旧数据分叉残留）：只裁 1 个而不是吞掉后面的 user
    history, counts = chain(
        ["assistant", "user", "assistant"], [60, 60, 60]
    )
    # fixed 30 + 180 = 210 > 160 → 队头 assistant step=1，裁 1 个后 150 ≤ 160
    assert _cut_count(history, counts, fixed=30, budget=160) == 1


def test_cut_everything_still_over():
    # 全裁仍超预算：返回 len(history)，prompt 本身超大交由 API 报错
    history, counts = chain(["user", "assistant"], [500, 500])
    assert _cut_count(history, counts, fixed=10, budget=100) == 2


def test_clamp_title():
    assert _clamp_title('"如何修复SSE断线"') == "如何修复SSE断线"
    assert _clamp_title("“中文引号标题”") == "中文引号标题"
    # 多行取首行
    assert _clamp_title("第一行标题\n第二行不是标题") == "第一行标题"
    # 超长截断到 TITLE_MAX_CHARS（16）
    long = "这是一个特别特别特别特别长的标题需要被截断处理掉"
    assert _clamp_title(long) == long[:16]
    # 空输入返回空串
    assert _clamp_title("  \n ") == ""
    assert _clamp_title("") == ""
