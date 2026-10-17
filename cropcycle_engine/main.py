"""
cropcycle/main.py
=================

FastAPI wrapper around the deterministic engine (soil / rotation / companion).
Called server-to-server by the Next.js backend, never by the browser.

Run:
    uvicorn cropcycle_engine.main:app --port 8000        (from the repo root)

Environment:
    CROPCYCLE_KB_PATH       path to crop_knowledge_base.xlsx
                            (default: the copy next to this file)
    CROPCYCLE_ENGINE_TOKEN  shared secret; when set, every route except
                            /health requires "Authorization: Bearer <token>"
"""

from __future__ import annotations

import hmac
import os
from dataclasses import asdict
from pathlib import Path
from typing import Annotated, Optional

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

try:
    from .companion import mix_check, pair_check
    from .knowledge import KnowledgeBase, get_kb
    from .models import SoilReading
    from .rotation import rotation_check
    from .soil import eligible_crops, soil_verdict
except ImportError:  # run from inside the package folder: uvicorn main:app
    from companion import mix_check, pair_check
    from knowledge import KnowledgeBase, get_kb
    from models import SoilReading
    from rotation import rotation_check
    from soil import eligible_crops, soil_verdict


def _kb_path() -> Optional[str]:
    env = os.environ.get("CROPCYCLE_KB_PATH")
    if env:
        return env
    local = Path(__file__).resolve().with_name("crop_knowledge_base.xlsx")
    return str(local) if local.exists() else None


# Load at import so a malformed spreadsheet stops the server from starting.
KB: KnowledgeBase = get_kb(_kb_path())

app = FastAPI(title="CropCycle Engine", version="1.0")


# ---------------------------------------------------------------------------
# Auth and errors
# ---------------------------------------------------------------------------

def require_token(authorization: Annotated[Optional[str], Header()] = None) -> None:
    expected = os.environ.get("CROPCYCLE_ENGINE_TOKEN")
    if not expected:
        return
    supplied = (authorization or "").removeprefix("Bearer ").strip()
    if not hmac.compare_digest(supplied.encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="Invalid or missing engine token.")


@app.exception_handler(RequestValidationError)
async def validation_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    # Omit the echoed input: a rejected NaN/Infinity would make the 422 body
    # itself unserialisable and turn it into a 500.
    errors = [{"loc": e["loc"], "msg": e["msg"], "type": e["type"]} for e in exc.errors()]
    return JSONResponse(status_code=422, content={"detail": errors})


@app.exception_handler(KeyError)
async def unknown_id_handler(_request: Request, exc: KeyError) -> JSONResponse:
    # kb.crop() raises KeyError for unknown crop IDs.
    return JSONResponse(status_code=404, content={"detail": str(exc.args[0]) if exc.args else "Not found."})


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

Reading = Annotated[Optional[float], Field(allow_inf_nan=False)]
CropId = Annotated[str, Field(pattern=r"^CRP\d{3}$")]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SoilReadingIn(Strict):
    moisture: Reading = None
    ph: Reading = None
    temperature: Reading = None
    ec: Reading = None
    n: Reading = None
    p: Reading = None
    k: Reading = None

    def to_model(self) -> SoilReading:
        return SoilReading(**self.model_dump())


class SoilVerdictIn(Strict):
    crop_id: CropId
    reading: SoilReadingIn


class EligibleIn(Strict):
    reading: SoilReadingIn


class RotationIn(Strict):
    prev_id: CropId
    next_id: CropId
    years_since: int = Field(ge=0, le=100)


class PairIn(Strict):
    a_id: CropId
    b_id: CropId


class MixIn(Strict):
    crop_ids: list[CropId] = Field(min_length=1, max_length=21)


class AssessIn(Strict):
    crop_ids: list[CropId] = Field(min_length=1, max_length=21)
    reading: SoilReadingIn
    previous_crop_ids: list[CropId] = Field(default_factory=list, max_length=21)
    years_since: int = Field(default=0, ge=0, le=100)
    mix_crop_ids: list[CropId] = Field(default_factory=list, max_length=21)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    return {"status": "ok", "kb_version": KB.version, "summary": KB.summary()}


@app.get("/crops", dependencies=[Depends(require_token)])
def crops() -> dict:
    return {
        "kb_version": KB.version,
        "crops": [
            {"crop_id": c.crop_id, "crop": c.crop, "family": c.family, "group": c.group}
            for c in sorted(KB.crops.values(), key=lambda c: c.crop_id)
        ],
    }


@app.post("/soil/verdict", dependencies=[Depends(require_token)])
def post_soil_verdict(body: SoilVerdictIn) -> dict:
    verdict = soil_verdict(body.crop_id, body.reading.to_model(), KB)
    return {"kb_version": KB.version, "verdict": asdict(verdict)}


@app.post("/soil/eligible", dependencies=[Depends(require_token)])
def post_eligible(body: EligibleIn) -> dict:
    verdicts = eligible_crops(body.reading.to_model(), KB)
    return {"kb_version": KB.version, "verdicts": [asdict(v) for v in verdicts]}


@app.post("/rotation/check", dependencies=[Depends(require_token)])
def post_rotation(body: RotationIn) -> dict:
    check = rotation_check(body.prev_id, body.next_id, body.years_since, KB)
    return {"kb_version": KB.version, "check": asdict(check)}


@app.post("/companion/pair", dependencies=[Depends(require_token)])
def post_pair(body: PairIn) -> dict:
    return {"kb_version": KB.version, "check": asdict(pair_check(body.a_id, body.b_id, KB))}


@app.post("/companion/mix", dependencies=[Depends(require_token)])
def post_mix(body: MixIn) -> dict:
    return {"kb_version": KB.version, "check": asdict(mix_check(body.crop_ids, KB))}


@app.post("/assess", dependencies=[Depends(require_token)])
def post_assess(body: AssessIn) -> dict:
    """One call per recommendation: soil verdict and rotation checks for every
    candidate, plus a mix check when 2+ mix crops are given, all against the
    same KB version."""
    reading = body.reading.to_model()
    candidates = [
        {
            "crop_id": cid,
            "soil": asdict(soil_verdict(cid, reading, KB)),
            "rotation": [
                asdict(rotation_check(prev, cid, body.years_since, KB))
                for prev in body.previous_crop_ids
            ],
        }
        for cid in body.crop_ids
    ]
    mix = asdict(mix_check(body.mix_crop_ids, KB)) if len(body.mix_crop_ids) >= 2 else None
    return {"kb_version": KB.version, "candidates": candidates, "mix": mix}
