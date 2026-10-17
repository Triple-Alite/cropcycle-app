"""
cropcycle/rotation.py
=====================

Rotation check: may `next_id` be planted on a plot that last grew `prev_id`?

Engine-enforced strict rules (applied before the sheet):
  * Same crop back-to-back                         -> X, strict
  * Solanaceae after Solanaceae, years_since < 2   -> X, strict
Otherwise the 3c_Rotation_Pairs rating and strictness are returned as-is.
"""

from __future__ import annotations

try:
    from .knowledge import KnowledgeBase
    from .models import RotationCheck
except ImportError:  # run as a script from inside the package folder
    from knowledge import KnowledgeBase
    from models import RotationCheck

SOLANACEAE_MIN_YEARS = 2


def rotation_check(prev_id: str, next_id: str, years_since: int,
                   kb: KnowledgeBase) -> RotationCheck:
    prev_crop = kb.crop(prev_id)
    next_crop = kb.crop(next_id)

    if prev_id == next_id:
        return RotationCheck(
            prev_id, next_id, years_since, "X", True,
            f"Same crop back-to-back ({prev_crop.crop}): soil-borne pests and "
            f"diseases carry straight over.",
        )

    if (prev_crop.family == "Solanaceae" and next_crop.family == "Solanaceae"
            and years_since < SOLANACEAE_MIN_YEARS):
        return RotationCheck(
            prev_id, next_id, years_since, "X", True,
            f"Solanaceae after Solanaceae ({prev_crop.crop} -> {next_crop.crop}) "
            f"within {SOLANACEAE_MIN_YEARS} years: shared bacterial wilt and nematodes.",
        )

    rule = kb.rotation_rule(prev_id, next_id)
    if rule is None:
        raise KeyError(f"No rotation rule for {prev_id} -> {next_id}")
    return RotationCheck(
        prev_id, next_id, years_since, rule.rating,
        rule.strictness == "STRICT", rule.reason,
    )


if __name__ == "__main__":
    from pathlib import Path

    try:
        from .knowledge import get_kb
    except ImportError:
        from knowledge import get_kb

    local = Path(__file__).resolve().with_name("crop_knowledge_base.xlsx")
    kb = get_kb(str(local) if local.exists() else None)

    cases = [
        ("CRP002", "CRP002", 0),  # maize -> maize
        ("CRP008", "CRP009", 1),  # tomato -> pepper, 1 yr
        ("CRP008", "CRP009", 3),  # tomato -> pepper, 3 yrs
        ("CRP002", "CRP003", 0),  # maize -> beans
        ("CRP008", "CRP016", 0),  # tomato -> sweet potato
        ("CRP017", "CRP002", 0),  # sheanut -> maize (NA)
    ]
    for prev_id, next_id, yrs in cases:
        r = rotation_check(prev_id, next_id, yrs, kb)
        tag = "STRICT" if r.strict else "advice"
        print(f"{kb.crops[prev_id].crop:>12} -> {kb.crops[next_id].crop:<12} "
              f"({yrs}y): {r.rating:<2} {tag:<6} {r.reason[:70]}")
