"""
cropcycle/models.py
===================

Result types for the soil, rotation and companion checks. All frozen:
checks are pure functions and their results are never mutated.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

# Per-parameter status
IDEAL = "IDEAL"
TOLERABLE = "TOLERABLE"
UNSUITABLE = "UNSUITABLE"
MISSING = "MISSING"

# Overall crop verdict (README ladder)
SUITABLE = "SUITABLE"
AMEND_FIRST = "AMEND_FIRST"
UNCONFIRMED = "UNCONFIRMED"
NOT_SUITABLE = "NOT_SUITABLE"


@dataclass(frozen=True)
class SoilReading:
    moisture: Optional[float] = None
    ph: Optional[float] = None
    temperature: Optional[float] = None
    ec: Optional[float] = None
    n: Optional[float] = None
    p: Optional[float] = None
    k: Optional[float] = None


@dataclass(frozen=True)
class ParamCheck:
    parameter: str          # moisture|ph|temperature|ec|n|p|k
    value: Optional[float]
    status: str             # IDEAL | TOLERABLE | UNSUITABLE | MISSING
    gate: str               # HARD | CORRECTABLE
    unit: str
    ideal_min: float
    ideal_max: float
    tolerable_min: float
    tolerable_max: float


@dataclass(frozen=True)
class SoilVerdict:
    crop_id: str
    crop: str
    overall: str            # IDEAL | SUITABLE | AMEND_FIRST | UNCONFIRMED | NOT_SUITABLE
    params: tuple[ParamCheck, ...]


@dataclass(frozen=True)
class RotationCheck:
    prev_id: str
    next_id: str
    years_since: int
    rating: str             # G | F | P | X | NA
    strict: bool
    reason: str


@dataclass(frozen=True)
class PairCheck:
    a_id: str
    b_id: str
    rating: str             # C | K | A | X
    strict: bool
    reason: str


@dataclass(frozen=True)
class MixCheck:
    crop_ids: tuple[str, ...]
    valid: bool
    reasons: tuple[str, ...]            # why invalid (empty when valid)
    never: tuple[PairCheck, ...]        # X pairs
    avoid: tuple[PairCheck, ...]        # A pairs
    conditional: tuple[PairCheck, ...]  # K pairs
