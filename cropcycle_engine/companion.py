"""
cropcycle/companion.py
======================

Companion checks: may crops share one plot at the same time?

pair_check engine rules (applied before the sheet):
  * Same crop                -> X, strict
  * Either is CRP005 (paddy) -> X, strict
Otherwise the 4b_Companion_Pairs rating and strictness are returned.

mix_check: invalid if over kb.mixing.max_crops_per_plot_strict or if any
unordered pair is X. A (avoid) and K (conditional) pairs are collected
as warnings but do not invalidate the mix.
"""

from __future__ import annotations

from itertools import combinations

try:
    from .knowledge import KnowledgeBase
    from .models import MixCheck, PairCheck
except ImportError:  # run as a script from inside the package folder
    from knowledge import KnowledgeBase
    from models import MixCheck, PairCheck

PADDY_RICE_ID = "CRP005"


def pair_check(a_id: str, b_id: str, kb: KnowledgeBase) -> PairCheck:
    a, b = kb.crop(a_id), kb.crop(b_id)

    if a_id == b_id:
        return PairCheck(a_id, b_id, "X", True,
                         f"Same crop ({a.crop}) listed twice on one plot.")
    if PADDY_RICE_ID in (a_id, b_id):
        return PairCheck(a_id, b_id, "X", True,
                         "Flooded paddy rice cannot share a plot with other crops.")

    rule = kb.companion_rule(a_id, b_id)
    if rule is None:
        raise KeyError(f"No companion rule for {a.crop} + {b.crop}")
    return PairCheck(a_id, b_id, rule.rating, rule.strictness == "STRICT", rule.reason)


def mix_check(crop_ids: list[str], kb: KnowledgeBase) -> MixCheck:
    limit = kb.mixing.max_crops_per_plot_strict
    reasons: list[str] = []
    if len(crop_ids) > limit:
        reasons.append(f"{len(crop_ids)} crops exceeds the strict limit of {limit} per plot.")

    pairs = [pair_check(a, b, kb) for a, b in combinations(crop_ids, 2)]
    never = tuple(p for p in pairs if p.rating == "X")
    avoid = tuple(p for p in pairs if p.rating == "A")
    conditional = tuple(p for p in pairs if p.rating == "K")
    for p in never:
        reasons.append(f"{kb.crops[p.a_id].crop} + {kb.crops[p.b_id].crop}: {p.reason}")

    return MixCheck(
        crop_ids=tuple(crop_ids),
        valid=not reasons,
        reasons=tuple(reasons),
        never=never,
        avoid=avoid,
        conditional=conditional,
    )


if __name__ == "__main__":
    from pathlib import Path

    try:
        from .knowledge import get_kb
    except ImportError:
        from knowledge import get_kb

    local = Path(__file__).resolve().with_name("crop_knowledge_base.xlsx")
    kb = get_kb(str(local) if local.exists() else None)

    for a, b in [("CRP002", "CRP003"), ("CRP008", "CRP009"), ("CRP002", "CRP005"),
                 ("CRP011", "CRP015"), ("CRP002", "CRP002")]:
        p = pair_check(a, b, kb)
        print(f"{kb.crops[a].crop:>10} + {kb.crops[b].crop:<10}: {p.rating} "
              f"{'STRICT' if p.strict else 'advice':<6} {p.reason[:70]}")

    mixes = [
        ["CRP001", "CRP002", "CRP006", "CRP014"],            # all-C set of 4
        ["CRP001", "CRP002", "CRP006", "CRP014", "CRP015"],  # 5 > cap
        ["CRP002", "CRP008", "CRP009"],                      # tomato + pepper
    ]
    for ids in mixes:
        m = mix_check(ids, kb)
        names = " + ".join(kb.crops[c].crop for c in ids)
        print(f"\n{names}\n  valid={m.valid}  X={len(m.never)} A={len(m.avoid)} "
              f"K={len(m.conditional)}")
        for r in m.reasons:
            print(f"  - {r[:90]}")
