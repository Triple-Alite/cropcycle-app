"""
cropcycle/knowledge.py
======================

Loads the Crop Advisory Knowledge Base (crop_knowledge_base.xlsx) into
typed, read-only structures. This module is the SOLE interface between the
spreadsheet and the rest of the engine.

Design rules:
  * Parse once at startup; cache via get_kb().
  * Never mutate KB data at runtime. Crop Scientists edit the xlsx and
    reload; every Recommendation records the KB version it used.
  * Fail loudly on malformed input — never silently skip a bad row that
    could produce a wrong verdict later.
  * Return dataclasses, not DataFrames.

Sheets consumed (must match README exactly):
  1_Crops              -> 21 crops, families, growing windows
  2b_Soil_Ranges_Long  -> canonical soil ranges (long format)
  3c_Rotation_Pairs    -> (prev, next) -> rating + reason
  4b_Companion_Pairs   -> {a, b} -> rating + reason
  5_Mixing_Limits      -> hard caps (small, structured)
  6_Rules              -> S01-S13, A01-A14
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Optional

import pandas as pd


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DEFAULT_KB_PATH = Path(__file__).resolve().parent.parent / "crop_knowledge_base.xlsx"

# Canonical parameter keys. Anything in 2b that maps to None is ignored
# (e.g. footer explanation rows).
PARAM_KEY_MAP: dict[str, str] = {
    "moisture":    "moisture",
    "ph":          "ph",
    "temperature": "temperature",
    "ec":          "ec",
    "n":           "n",
    "p":           "p",
    "k":           "k",
}

PARAM_DISPLAY: dict[str, str] = {
    "moisture": "moisture",
    "ph": "pH",
    "temperature": "temperature",
    "ec": "EC",
    "n": "N",
    "p": "P",
    "k": "K",
}

# Gate per parameter, fixed by the KB design (see README "Gate:" line).
PARAM_GATE: dict[str, str] = {
    "moisture": "HARD",
    "ph": "HARD",
    "temperature": "HARD",
    "ec": "HARD",
    "n": "CORRECTABLE",
    "p": "CORRECTABLE",
    "k": "CORRECTABLE",
}

EXPECTED_CROP_COUNT = 21
EXPECTED_ROTATION_ROWS = 441   # 21 * 21
EXPECTED_COMPANION_ROWS = 210  # C(21, 2)


# ---------------------------------------------------------------------------
# Typed data structures
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Crop:
    crop_id: str
    crop: str
    scientific_name: str
    family: str
    group: str
    life_cycle: str
    growing_window: str
    temperature_class: str
    planting_window: str
    notes: str


@dataclass(frozen=True)
class SoilRange:
    """One (crop, parameter) pair from 2b_Soil_Ranges_Long."""
    crop_id: str
    crop: str
    parameter: str          # canonical: moisture|ph|temperature|ec|n|p|k
    unit: str
    ideal_min: float
    ideal_max: float
    tolerable_min: float
    tolerable_max: float
    gate: str               # HARD | CORRECTABLE
    unsuitable_rule: str


@dataclass(frozen=True)
class RotationRule:
    prev_id: str
    prev_crop: str
    next_id: str
    next_crop: str
    rating: str             # G | F | P | X | NA
    meaning: str
    strictness: str         # STRICT | ADVICE | n/a
    reason: str


@dataclass(frozen=True)
class CompanionRule:
    crop_a_id: str
    crop_a: str
    crop_b_id: str
    crop_b: str
    rating: str             # C | K | A | X
    meaning: str
    strictness: str         # STRICT | ADVICE | n/a
    reason: str


@dataclass(frozen=True)
class MixingLimits:
    max_crops_per_plot_strict: int
    recommended_per_plot_min: int
    recommended_per_plot_max: int
    max_per_family: dict[str, int]
    shea_annuals_max: int
    raw_rows: list[tuple[str, str, str]] = field(default_factory=list)


@dataclass(frozen=True)
class Rule:
    rule_id: str
    type: str               # STRICT | ADVICE
    area: str
    rule: str
    action: str
    why: str
    confidence: str


# ---------------------------------------------------------------------------
# KnowledgeBase
# ---------------------------------------------------------------------------

class KnowledgeBase:
    """
    Immutable snapshot of the knowledge base.

    Attribute access patterns:
        kb.crops["CRP001"]                      -> Crop
        kb.soil["CRP001"]["moisture"]           -> SoilRange
        kb.rotation[("CRP001", "CRP002")]       -> RotationRule
        kb.companion[frozenset(("CRP001","CRP002"))] -> CompanionRule
        kb.mixing                               -> MixingLimits
        kb.rules["S01"]                         -> Rule
        kb.version                              -> 'a1b2c3d4e5f6'
    """

    def __init__(self, path: Path = DEFAULT_KB_PATH):
        self.path = Path(path)
        if not self.path.exists():
            raise FileNotFoundError(
                f"Knowledge base not found: {self.path}. "
                f"Place crop_knowledge_base.xlsx next to the cropcycle/ package."
            )

        self.version: str = self._hash_file(self.path)

        # Parsed tables (all built in __init__ so failures surface early)
        self.crops: dict[str, Crop] = self._load_crops()
        self.soil: dict[str, dict[str, SoilRange]] = self._load_soil_ranges()
        self.rotation: dict[tuple[str, str], RotationRule] = self._load_rotation_pairs()
        self.companion: dict[frozenset, CompanionRule] = self._load_companion_pairs()
        self.mixing: MixingLimits = self._load_mixing_limits()
        self.rules: dict[str, Rule] = self._load_rules()

        # Convenience indexes
        self.crops_by_family: dict[str, list[str]] = self._index_by_family()
        self.solanaceae_ids: set[str] = {
            cid for cid, c in self.crops.items() if c.family == "Solanaceae"
        }

        self._validate()

    # ---- helpers ---------------------------------------------------------

    @staticmethod
    def _hash_file(path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()[:12]

    @staticmethod
    def _clean_id(value: object) -> str:
        """'CRP001' from 'CRP001 ' or pandas nan -> ''. Used everywhere."""
        if value is None or (isinstance(value, float) and pd.isna(value)):
            return ""
        return str(value).replace('\xa0', ' ').strip()

    @staticmethod
    def _clean_float(value: object, field_name: str) -> float:
        """Parse a numeric cell, tolerating '20-30'-style strings is NOT
        attempted here — 2b has clean numeric columns. Raise clearly."""
        try:
            return float(value)
        except (TypeError, ValueError):
            raise ValueError(
                f"Non-numeric value {value!r} in field {field_name!r}"
            )

    # ---- sheet loaders ---------------------------------------------------

    def _load_crops(self) -> dict[str, Crop]:
        df = pd.read_excel(self.path, sheet_name="1_Crops")
        out: dict[str, Crop] = {}
        for _, r in df.iterrows():
            cid = self._clean_id(r.get("Crop ID"))
            if not cid.startswith("CRP"):
                continue
            out[cid] = Crop(
                crop_id=cid,
                crop=str(r["Crop"]).replace('\xa0', ' ').strip(),
                scientific_name=str(r.get("Scientific name (as assumed)", "")).replace('\xa0', ' ').strip(),
                family=str(r["Family"]).replace('\xa0', ' ').strip(),
                group=str(r["Group"]).replace('\xa0', ' ').strip(),
                life_cycle=str(r["Life cycle"]).replace('\xa0', ' ').strip(),
                growing_window=str(r["Growing window"]).replace('\xa0', ' ').strip(),
                temperature_class=str(r["Temperature class"]).replace('\xa0', ' ').strip(),
                planting_window=str(
                    r.get("Approx. Minna planting window (confirm locally)", "")
                ).replace('\xa0', ' ').strip(),
                notes=str(r.get("Notes / assumption", "")).replace('\xa0', ' ').strip(),
            )
        return out

    def _load_soil_ranges(self) -> dict[str, dict[str, SoilRange]]:
        df = pd.read_excel(self.path, sheet_name="2b_Soil_Ranges_Long")
        out: dict[str, dict[str, SoilRange]] = {}
        for _, r in df.iterrows():
            cid = self._clean_id(r.get("crop_id"))
            if not cid.startswith("CRP"):
                continue  # footer rows

            raw_param = str(r["parameter"]).replace('\xa0', ' ').strip().lower()
            param = PARAM_KEY_MAP.get(raw_param)
            if param is None:
                # Unknown parameter — raise; don't skip silently
                raise ValueError(
                    f"Unknown soil parameter {raw_param!r} for {cid}. "
                    f"Expected one of {list(PARAM_KEY_MAP)}."
                )

            unit = str(r.get("unit", "")).replace('\xa0', ' ').strip()
            gate_cell = str(r.get("gate", "")).replace('\xa0', ' ').strip().upper()
            expected_gate = PARAM_GATE[param]
            if gate_cell and gate_cell != expected_gate:
                raise ValueError(
                    f"Gate mismatch for {cid}/{param}: sheet says {gate_cell!r}, "
                    f"expected {expected_gate!r}."
                )

            sr = SoilRange(
                crop_id=cid,
                crop=str(r["crop"]).replace('\xa0', ' ').strip(),
                parameter=param,
                unit=unit,
                ideal_min=self._clean_float(r["ideal_min"], f"{cid}.{param}.ideal_min"),
                ideal_max=self._clean_float(r["ideal_max"], f"{cid}.{param}.ideal_max"),
                tolerable_min=self._clean_float(r["tolerable_min"], f"{cid}.{param}.tol_min"),
                tolerable_max=self._clean_float(r["tolerable_max"], f"{cid}.{param}.tol_max"),
                gate=expected_gate,
                unsuitable_rule=str(r.get("unsuitable_rule", "")).replace('\xa0', ' ').strip(),
            )

            if sr.ideal_min > sr.ideal_max:
                raise ValueError(f"{cid}/{param}: ideal_min > ideal_max")
            if sr.tolerable_min > sr.ideal_min:
                raise ValueError(f"{cid}/{param}: tolerable_min > ideal_min")
            if sr.tolerable_max < sr.ideal_max:
                raise ValueError(f"{cid}/{param}: tolerable_max < ideal_max")

            out.setdefault(cid, {})[param] = sr
        return out

    def _load_rotation_pairs(self) -> dict[tuple[str, str], RotationRule]:
        df = pd.read_excel(self.path, sheet_name="3c_Rotation_Pairs")
        out: dict[tuple[str, str], RotationRule] = {}
        for _, r in df.iterrows():
            prev_id = self._clean_id(r.get("prev_id"))
            next_id = self._clean_id(r.get("next_id"))
            if not (prev_id.startswith("CRP") and next_id.startswith("CRP")):
                continue
            # pandas reads 'n/a' cells as NaN -> 'NAN'; restore 'n/a'
            strictness = str(r["strictness"]).replace('\xa0', ' ').strip().upper()
            if strictness == "NAN":
                strictness = "n/a"
            rule = RotationRule(
                prev_id=prev_id,
                prev_crop=str(r["prev_crop"]).replace('\xa0', ' ').strip(),
                next_id=next_id,
                next_crop=str(r["next_crop"]).replace('\xa0', ' ').strip(),
                rating=str(r["rating"]).replace('\xa0', ' ').strip().upper(),
                meaning=str(r["meaning"]).replace('\xa0', ' ').strip(),
                strictness=strictness,
                reason=str(r["reason"]).replace('\xa0', ' ').strip(),
            )
            # Convert pandas 'NAN' to 'NA' for engine logic
            if rule.rating == "NAN":
                rule = RotationRule(
                    prev_id=rule.prev_id, prev_crop=rule.prev_crop,
                    next_id=rule.next_id, next_crop=rule.next_crop,
                    rating="NA", meaning=rule.meaning,
                    strictness=rule.strictness, reason=rule.reason
                )
            if rule.rating not in {"G", "F", "P", "X", "NA"}:
                raise ValueError(f"Bad rotation rating {rule.rating!r} for {prev_id}->{next_id}")
            out[(prev_id, next_id)] = rule
        return out

    def _load_companion_pairs(self) -> dict[frozenset, CompanionRule]:
        df = pd.read_excel(self.path, sheet_name="4b_Companion_Pairs")
        out: dict[frozenset, CompanionRule] = {}
        for _, r in df.iterrows():
            a_id = self._clean_id(r.get("crop_a_id"))
            b_id = self._clean_id(r.get("crop_b_id"))
            if not (a_id.startswith("CRP") and b_id.startswith("CRP")):
                continue
            # pandas reads 'n/a' cells as NaN -> 'NAN'; restore 'n/a'
            strictness = str(r["strictness"]).replace('\xa0', ' ').strip().upper()
            if strictness == "NAN":
                strictness = "n/a"
            rule = CompanionRule(
                crop_a_id=a_id,
                crop_a=str(r["crop_a"]).replace('\xa0', ' ').strip(),
                crop_b_id=b_id,
                crop_b=str(r["crop_b"]).replace('\xa0', ' ').strip(),
                rating=str(r["rating"]).replace('\xa0', ' ').strip().upper(),
                meaning=str(r["meaning"]).replace('\xa0', ' ').strip(),
                strictness=strictness,
                reason=str(r["reason"]).replace('\xa0', ' ').strip(),
            )
            if rule.rating not in {"C", "K", "A", "X", "NAN"}:
                raise ValueError(f"Bad companion rating {rule.rating!r} for {a_id}+{b_id}")
            out[frozenset((a_id, b_id))] = rule
        return out

    def _load_mixing_limits(self) -> MixingLimits:
        """
        5_Mixing_Limits is a small, semi-structured sheet. The relevant
        numbers are read by label from column A. Everything else (the long
        lists of 3/4/5-crop sets) is intentionally not loaded — it can be
        recomputed from the companion matrix and we don't want to trust a
        hardcoded list that might drift.
        """
        df = pd.read_excel(self.path, sheet_name="5_Mixing_Limits")
        raw_rows: list[tuple[str, str, str]] = [
            (str(r.iloc[0]).replace('\xa0', ' ').strip(), str(r.iloc[1]).replace('\xa0', ' ').strip(), str(r.iloc[2]).replace('\xa0', ' ').strip())
            for _, r in df.iterrows()
        ]

        max_crops = 4           # design cap (README)
        rec_min, rec_max = 2, 3
        shea_max = 3
        family_limits: dict[str, int] = {
            "Solanaceae": 1,
            "Malvaceae": 1,     # okro + hibiscus
            "Poaceae": 2,       # cereals
            "Fabaceae": 2,      # legumes
        }

        for a, b, _c in raw_rows:
            key = a.lower()
            if "max crops mixed on one plot" in key:
                try:
                    max_crops = int(b)
                except ValueError:
                    pass
            elif "recommended crops per plot" in key:
                # e.g. "2 to 3"
                try:
                    parts = b.replace("to", "-").split("-")
                    rec_min = int(parts[0].strip())
                    rec_max = int(parts[-1].strip())
                except (ValueError, IndexError):
                    pass
            elif "shea tree plus annuals" in key:
                try:
                    shea_max = int(b.split("+")[1].strip().split()[0])
                except (ValueError, IndexError):
                    pass

        return MixingLimits(
            max_crops_per_plot_strict=max_crops,
            recommended_per_plot_min=rec_min,
            recommended_per_plot_max=rec_max,
            max_per_family=family_limits,
            shea_annuals_max=shea_max,
            raw_rows=raw_rows,
        )

    def _load_rules(self) -> dict[str, Rule]:
        df = pd.read_excel(self.path, sheet_name="6_Rules")
        out: dict[str, Rule] = {}
        for _, r in df.iterrows():
            rid = self._clean_id(r.get("Rule ID"))
            if not rid:
                continue
            out[rid] = Rule(
                rule_id=rid,
                type=str(r["Type"]).replace('\xa0', ' ').strip().upper(),
                area=str(r["Area"]).replace('\xa0', ' ').strip(),
                rule=str(r["Rule"]).replace('\xa0', ' ').strip(),
                action=str(r["How the AI must act"]).replace('\xa0', ' ').strip(),
                why=str(r["Why"]).replace('\xa0', ' ').strip(),
                confidence=str(r.get("Evidence confidence", "")).replace('\xa0', ' ').strip(),
            )
        return out

    # ---- post-load indexing / validation ---------------------------------

    def _index_by_family(self) -> dict[str, list[str]]:
        out: dict[str, list[str]] = {}
        for cid, c in self.crops.items():
            out.setdefault(c.family, []).append(cid)
        return out

    def _validate(self) -> None:
        n_crops = len(self.crops)
        if n_crops != EXPECTED_CROP_COUNT:
            raise ValueError(
                f"Expected {EXPECTED_CROP_COUNT} crops, loaded {n_crops}. "
                f"Crop IDs: {sorted(self.crops)}"
            )

        # Every crop must have all 7 soil parameters.
        for cid in self.crops:
            missing = set(PARAM_KEY_MAP.values()) - set(self.soil.get(cid, {}))
            if missing:
                raise ValueError(f"Crop {cid} missing soil ranges for: {sorted(missing)}")

        # Rotation matrix must be 21x21 = 441.
        if len(self.rotation) != EXPECTED_ROTATION_ROWS:
            raise ValueError(
                f"Expected {EXPECTED_ROTATION_ROWS} rotation pairs, got {len(self.rotation)}."
            )

        # Companion matrix: 210 unordered pairs.
        if len(self.companion) != EXPECTED_COMPANION_ROWS:
            raise ValueError(
                f"Expected {EXPECTED_COMPANION_ROWS} companion pairs, got {len(self.companion)}."
            )

        # Symmetry spot-check: A+B and B+A must agree.
        for key in list(self.companion)[:20]:
            a, b = tuple(key)
            if frozenset((b, a)) not in self.companion:
                raise ValueError(f"Companion matrix not symmetric at {a}+{b}.")

        # All STRICT rules must exist.
        for rid in [f"S{i:02d}" for i in range(1, 14)]:
            if rid not in self.rules:
                raise ValueError(f"Missing strict rule {rid} in 6_Rules.")

    # ---- convenience accessors ------------------------------------------

    def crop(self, crop_id: str) -> Crop:
        try:
            return self.crops[crop_id]
        except KeyError:
            raise KeyError(f"Unknown crop ID {crop_id!r}. Known: {sorted(self.crops)}")

    def soil_range(self, crop_id: str, parameter: str) -> SoilRange:
        return self.soil[crop_id][parameter]

    def rotation_rule(self, prev_id: str, next_id: str) -> Optional[RotationRule]:
        return self.rotation.get((prev_id, next_id))

    def companion_rule(self, a_id: str, b_id: str) -> Optional[CompanionRule]:
        return self.companion.get(frozenset((a_id, b_id)))

    def crops_in_family(self, family: str) -> list[str]:
        return list(self.crops_by_family.get(family, []))

    def summary(self) -> dict:
        return {
            "version": self.version,
            "crops": len(self.crops),
            "soil_params": sum(len(v) for v in self.soil.values()),
            "rotation_pairs": len(self.rotation),
            "companion_pairs": len(self.companion),
            "rules": len(self.rules),
            "strict_rules": sum(1 for r in self.rules.values() if r.type == "STRICT"),
            "advice_rules": sum(1 for r in self.rules.values() if r.type == "ADVICE"),
            "families": {fam: len(ids) for fam, ids in self.crops_by_family.items()},
        }


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def get_kb(path: Optional[str] = None) -> KnowledgeBase:
    """
    Process-wide knowledge base. Call with no args for the default path.
    Pass a different path in tests to load a fixture.
    """
    return KnowledgeBase(Path(path) if path else DEFAULT_KB_PATH)


def reset_kb() -> None:
    """Clear the cache (used by tests when swapping fixtures)."""
    get_kb.cache_clear()


# ---------------------------------------------------------------------------
# Sanity check
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import json

    kb = get_kb()
    print("Knowledge base loaded OK\n")
    print(json.dumps(kb.summary(), indent=2))

    print("\n-- sample crop --")
    print(kb.crops["CRP008"])

    print("\n-- sample soil range (tomato, pH) --")
    print(kb.soil["CRP008"]["ph"])

    print("\n-- sample rotation (tomato -> pepper) --")
    print(kb.rotation[("CRP008", "CRP009")])

    print("\n-- sample companion (tomato + pepper) --")
    print(kb.companion[frozenset(("CRP008", "CRP009"))])

    print("\n-- mixing limits --")
    print(kb.mixing)

    print("\n-- strict rules --")
    for rid, r in kb.rules.items():
        if r.type == "STRICT":
            print(f"  {rid}: {r.area} — {r.rule[:60]}...")