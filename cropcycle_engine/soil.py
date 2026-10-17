"""
cropcycle/soil.py
=================

Soil verdict for one crop against one sensor reading.

Verdict ladder (README "RATING KEYS"), checked in this order:
  1. Any HARD param (moisture/pH/temperature/EC) UNSUITABLE -> NOT_SUITABLE
  2. Any param missing                                      -> UNCONFIRMED
  3. Only N/P/K UNSUITABLE                                  -> AMEND_FIRST
  4. All 7 IDEAL                                            -> IDEAL
  5. Otherwise                                              -> SUITABLE

Range bounds are inclusive (sheet: "UNSUITABLE if value < min or > max").
"""

from __future__ import annotations

try:
    from .knowledge import PARAM_GATE, KnowledgeBase, SoilRange
    from .models import (AMEND_FIRST, IDEAL, MISSING, NOT_SUITABLE, SUITABLE, TOLERABLE,
                         UNCONFIRMED, UNSUITABLE, ParamCheck, SoilReading, SoilVerdict)
except ImportError:  # run as a script from inside the package folder
    from knowledge import PARAM_GATE, KnowledgeBase, SoilRange
    from models import (AMEND_FIRST, IDEAL, MISSING, NOT_SUITABLE, SUITABLE, TOLERABLE,
                        UNCONFIRMED, UNSUITABLE, ParamCheck, SoilReading, SoilVerdict)


def _status(value: float | None, sr: SoilRange) -> str:
    if value is None:
        return MISSING
    if sr.ideal_min <= value <= sr.ideal_max:
        return IDEAL
    if sr.tolerable_min <= value <= sr.tolerable_max:
        return TOLERABLE
    return UNSUITABLE


def _check(param: str, value: float | None, sr: SoilRange) -> ParamCheck:
    return ParamCheck(
        parameter=param,
        value=value,
        status=_status(value, sr),
        gate=sr.gate,
        unit=sr.unit,
        ideal_min=sr.ideal_min,
        ideal_max=sr.ideal_max,
        tolerable_min=sr.tolerable_min,
        tolerable_max=sr.tolerable_max,
    )


def soil_verdict(crop_id: str, reading: SoilReading, kb: KnowledgeBase) -> SoilVerdict:
    crop = kb.crop(crop_id)
    checks = tuple(
        _check(param, getattr(reading, param), kb.soil_range(crop_id, param))
        for param in PARAM_GATE
    )
    statuses = [c.status for c in checks]

    if any(c.status == UNSUITABLE and c.gate == "HARD" for c in checks):
        overall = NOT_SUITABLE
    elif MISSING in statuses:
        overall = UNCONFIRMED
    elif UNSUITABLE in statuses:  # only CORRECTABLE (N/P/K) can reach here
        overall = AMEND_FIRST
    elif all(s == IDEAL for s in statuses):
        overall = IDEAL
    else:
        overall = SUITABLE

    return SoilVerdict(crop_id=crop_id, crop=crop.crop, overall=overall, params=checks)


def eligible_crops(reading: SoilReading, kb: KnowledgeBase) -> list[SoilVerdict]:
    """Verdicts for every crop whose overall is not NOT_SUITABLE, in crop-ID order."""
    verdicts = (soil_verdict(cid, reading, kb) for cid in sorted(kb.crops))
    return [v for v in verdicts if v.overall != NOT_SUITABLE]


if __name__ == "__main__":
    from pathlib import Path

    try:
        from .knowledge import get_kb
    except ImportError:
        from knowledge import get_kb

    local = Path(__file__).resolve().with_name("crop_knowledge_base.xlsx")
    kb = get_kb(str(local) if local.exists() else None)

    reading = SoilReading(moisture=25, ph=6.2, temperature=27, ec=400, n=40, p=20, k=150)
    print(f"Reading: {reading}\n")

    v = soil_verdict("CRP002", reading, kb)
    print(f"{v.crop_id} {v.crop}: {v.overall}")
    for c in v.params:
        print(f"  {c.parameter:<12} {c.value!s:>6} {c.unit:<14} {c.status:<10} "
              f"ideal {c.ideal_min}-{c.ideal_max}, tol {c.tolerable_min}-{c.tolerable_max}")

    partial = SoilReading(moisture=25, ph=6.2, temperature=27)
    print(f"\nPartial reading -> CRP002: {soil_verdict('CRP002', partial, kb).overall}")

    print("\nEligible crops for full reading:")
    for v in eligible_crops(reading, kb):
        print(f"  {v.crop_id} {v.crop:<14} {v.overall}")
