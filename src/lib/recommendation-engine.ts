import { FarmingMethod, Prisma } from "@prisma/client";
import { StructuredKnowledgeBody } from "@/lib/agricultural-knowledge";
import { canonicalCropName, CROP_OPTIONS } from "@/lib/crops";

export type SeasonRecommendationContext = {
  seasonId: string;
  seasonName: string;
  farmId: string;
  farmName: string;
  farmerId: string;
  plotId: string;
  plotName: string;
  location: string | null;
  farmingMethod: FarmingMethod;
  preferredMethod: FarmingMethod | null;
  otherRequirements: string | null;
  intendedCrops: string[];
  availableCrops: string[];
  marketableCrops: string[];
  previousCrops: string[];
  soil: {
    nitrogen: number | null;
    phosphorus: number | null;
    potassium: number | null;
    soilTemperature: number | null;
    humidity: number | null;
    recordedAt: string | null;
  };
};

export type ActiveRule = {
  id: string;
  key: string;
  version: number;
  title: string;
  sourceCitation: string;
  body: StructuredKnowledgeBody;
};

export type CropAssessment = {
  crop: string;
  suitability: "supported" | "review-needed" | "insufficient-data";
  reasons: string[];
  alternatives: string[];
  considerations: string[];
  knowledge: Array<{ id: string; title: string; source: string; version: number }>;
};

function rangeStatus(value: number | null, range: { min?: number; max?: number }) {
  if (value === null) return "missing";
  if (range.min !== undefined && value < range.min) return "outside";
  if (range.max !== undefined && value > range.max) return "outside";
  return "inside";
}

export function assessCrops(context: SeasonRecommendationContext, rules: ActiveRule[]) {
  const requested = [
    ...context.intendedCrops,
    ...context.availableCrops,
    ...context.marketableCrops,
  ];
  const candidates = [...new Map(requested.map((crop) => [crop.trim().toLocaleLowerCase(), crop.trim()])).values()];
  const applicable = rules.filter((rule) => {
    if (rule.body.region) {
      if (!context.location || !context.location.toLocaleLowerCase().includes(rule.body.region.toLocaleLowerCase())) {
        return false;
      }
    }
    return true;
  });
  const requestedCrops = new Set(candidates.map((crop) => crop.toLocaleLowerCase()));

  const assessments: CropAssessment[] = candidates.map((crop) => {
    const cropRules = applicable.filter((rule) => rule.body.crop.toLocaleLowerCase() === crop.toLocaleLowerCase());
    if (!cropRules.length) {
      return {
        crop,
        suitability: "insufficient-data",
        reasons: [],
        alternatives: [],
        considerations: ["No currently approved, region-matched knowledge rule exists for this crop."],
        knowledge: [],
      };
    }

    const reasons = new Set<string>();
    const considerations = new Set<string>();
    const alternatives = new Set<string>();
    const citations = new Map<string, CropAssessment["knowledge"][number]>();
    let hasMissingCriteria = false;
    let hasOutsideCriteria = false;
    if (context.otherRequirements) {
      hasMissingCriteria = true;
      considerations.add("Other farmer requirements are recorded but are not encoded in an approved rule for this assessment.");
    }
    for (const rule of cropRules) {
      rule.body.reasons.forEach((reason) => reasons.add(reason));
      rule.body.considerations.forEach((item) => considerations.add(item));
      rule.body.alternatives.forEach((item) => alternatives.add(item));
      citations.set(rule.id, {
        id: rule.id,
        title: rule.title,
        source: rule.sourceCitation,
        version: rule.version,
      });
      if (
        rule.body.farmingMethods?.length &&
        !rule.body.farmingMethods.includes(context.farmingMethod)
      ) {
        if (context.farmingMethod === FarmingMethod.NOT_RECORDED) {
          hasMissingCriteria = true;
          considerations.add("The farming method is not recorded for this approved method criterion.");
        } else {
          hasOutsideCriteria = true;
          considerations.add("The recorded farming method is outside this rule's approved methods.");
        }
      }
      if (rule.body.avoidAfter?.length) {
        if (!context.previousCrops.length) {
          hasMissingCriteria = true;
          considerations.add("Previous crop history is not recorded for this approved crop-history criterion.");
        } else if (rule.body.avoidAfter.some((previous) =>
          context.previousCrops.some((cropName) => cropName.toLocaleLowerCase() === previous.toLocaleLowerCase())
        )) {
          hasOutsideCriteria = true;
          considerations.add("A recorded previous crop matches this rule's avoid-after condition.");
        } else {
          reasons.add("Recorded previous crops do not match this rule's avoid-after condition.");
        }
      }
      for (const criterion of ["nitrogen", "phosphorus", "potassium", "soilTemperature", "humidity"] as const) {
        const range = rule.body.soil?.[criterion];
        if (!range) continue;
        const reading = context.soil[criterion];
        const result = rangeStatus(reading, range);
        if (result === "missing") {
          hasMissingCriteria = true;
          considerations.add(`No soil ${criterion} value is available to evaluate this approved range.`);
        } else if (result === "outside") {
          hasOutsideCriteria = true;
          considerations.add(`Recorded soil ${criterion} is outside this approved rule's range.`);
        } else {
          reasons.add(`Recorded soil ${criterion} is within this approved rule's range.`);
        }
      }
    }
    if (context.preferredMethod && context.preferredMethod !== context.farmingMethod) {
      hasOutsideCriteria = true;
      considerations.add("The season farming method differs from the farmer's preferred method.");
    }

    return {
      crop,
      suitability: hasOutsideCriteria
        ? "review-needed"
        : hasMissingCriteria
          ? "insufficient-data"
          : "supported",
      reasons: [...reasons],
      alternatives: [...alternatives].filter((alternative) => {
        const key = alternative.toLocaleLowerCase();
        return key !== crop.toLocaleLowerCase() &&
          requestedCrops.has(key) && applicable.some((rule) =>
          rule.body.crop.toLocaleLowerCase() === key,
        );
      }),
      considerations: [...considerations],
      knowledge: [...citations.values()],
    };
  });

  return {
    candidates: assessments,
    notice: candidates.length
      ? "Assessments use only currently approved knowledge. They are decision-support, not a guarantee of yield or a substitute for local expert review."
      : "No intended, available, or marketable crops are recorded for this season. Add the farmer's crop requirements before requesting an assessment.",
    dataUsed: context,
  };
}

// ---------------------------------------------------------------------------
// CropCycle engine bridge
// Server-to-server client for the Python FastAPI service in cropcycle_engine/.
// Server-only: it reads CROPCYCLE_ENGINE_TOKEN, so never import it into client
// components. Wire types mirror the engine's JSON (snake_case) exactly.
// ---------------------------------------------------------------------------

const ENGINE_TIMEOUT_MS = 10_000;

// App crop names -> knowledge-base crop IDs (1_Crops sheet).
export const ENGINE_CROP_IDS: Record<(typeof CROP_OPTIONS)[number], string> = {
  Yam: "CRP001",
  Maize: "CRP002",
  Beans: "CRP003",
  "Guinea Corn": "CRP004",
  Rice: "CRP005",
  Groundnut: "CRP006",
  "Soya Beans": "CRP007",
  Tomatoes: "CRP008",
  Pepper: "CRP009",
  Millet: "CRP010",
  Okro: "CRP011",
  "Bambara nut": "CRP012",
  Cassava: "CRP013",
  Spinach: "CRP014",
  Hibiscus: "CRP015",
  Potatoes: "CRP016", // KB: Sweet Potato
  Sheanut: "CRP017",
  Sesame: "CRP018",
  Sugarcane: "CRP019",
  Gardenegg: "CRP020", // KB: Garden Egg
  Onions: "CRP021",
};

export function engineCropId(cropName: string): string | null {
  const crop = canonicalCropName(cropName);
  return crop ? ENGINE_CROP_IDS[crop] : null;
}

export type EngineSoilReading = {
  moisture: number | null;
  ph: number | null;
  temperature: number | null;
  ec: number | null;
  n: number | null;
  p: number | null;
  k: number | null;
};

type DbNumber = Prisma.Decimal | number | null | undefined;

function toEngineNumber(value: DbNumber) {
  return value === null || value === undefined ? null : Number(value);
}

// Maps a stored SoilReading to the engine's parameters. Missing values stay
// null, never zero. SoilReading has no EC column, so ec is always null and
// verdicts cannot rise above UNCONFIRMED until EC is recorded. `humidity` is
// not volumetric soil moisture and is deliberately not mapped.
export function engineSoilReading(reading: {
  moisture?: DbNumber;
  pH?: DbNumber;
  soilTemperature?: DbNumber;
  nitrogen?: DbNumber;
  phosphorus?: DbNumber;
  potassium?: DbNumber;
} | null): EngineSoilReading {
  return {
    moisture: toEngineNumber(reading?.moisture),
    ph: toEngineNumber(reading?.pH),
    temperature: toEngineNumber(reading?.soilTemperature),
    ec: null,
    n: toEngineNumber(reading?.nitrogen),
    p: toEngineNumber(reading?.phosphorus),
    k: toEngineNumber(reading?.potassium),
  };
}

export type EngineParamCheck = {
  parameter: "moisture" | "ph" | "temperature" | "ec" | "n" | "p" | "k";
  value: number | null;
  status: "IDEAL" | "TOLERABLE" | "UNSUITABLE" | "MISSING";
  gate: "HARD" | "CORRECTABLE";
  unit: string;
  ideal_min: number;
  ideal_max: number;
  tolerable_min: number;
  tolerable_max: number;
};

export type EngineSoilVerdict = {
  crop_id: string;
  crop: string;
  overall: "IDEAL" | "SUITABLE" | "AMEND_FIRST" | "UNCONFIRMED" | "NOT_SUITABLE";
  params: EngineParamCheck[];
};

export type EngineRotationCheck = {
  prev_id: string;
  next_id: string;
  years_since: number;
  rating: "G" | "F" | "P" | "X" | "NA";
  strict: boolean;
  reason: string;
};

export type EnginePairCheck = {
  a_id: string;
  b_id: string;
  rating: "C" | "K" | "A" | "X";
  strict: boolean;
  reason: string;
};

export type EngineMixCheck = {
  crop_ids: string[];
  valid: boolean;
  reasons: string[];
  never: EnginePairCheck[];
  avoid: EnginePairCheck[];
  conditional: EnginePairCheck[];
};

export type EngineCrop = { crop_id: string; crop: string; family: string; group: string };

// Engine unreachable, timed out, misconfigured or failed (5xx). Map to the
// contract's 503 { code, message, retryable } response; never substitute a result.
export class EngineUnavailableError extends Error {
  readonly code = "ENGINE_UNAVAILABLE";
  readonly retryable = true;
}

// Engine rejected the request (4xx). `engineStatus` is the engine's status,
// not the end user's: a 401 here means the server's engine token is wrong.
export class EngineRequestError extends Error {
  constructor(message: string, readonly engineStatus: number) {
    super(message);
  }
}

async function engineRequest<T>(path: string, body?: unknown): Promise<T & { kb_version: string }> {
  const baseUrl = process.env.CROPCYCLE_ENGINE_URL;
  if (!baseUrl) throw new EngineUnavailableError("CROPCYCLE_ENGINE_URL is not configured.");

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const token = process.env.CROPCYCLE_ENGINE_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, "")}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
    });
  } catch (error) {
    throw new EngineUnavailableError("The CropCycle engine could not be reached.", { cause: error });
  }

  const payload: unknown = await response.json().catch(() => null);
  if (response.status >= 500) {
    throw new EngineUnavailableError(`The CropCycle engine failed with HTTP ${response.status}.`);
  }
  if (!response.ok) {
    const detail = payload && typeof payload === "object" && "detail" in payload
      ? JSON.stringify(payload.detail)
      : `HTTP ${response.status}`;
    throw new EngineRequestError(`The CropCycle engine rejected the request: ${detail}`, response.status);
  }
  if (!payload || typeof payload !== "object" || !("kb_version" in payload)) {
    throw new EngineUnavailableError("The CropCycle engine returned an unexpected response.");
  }
  return payload as T & { kb_version: string };
}

export function engineCrops() {
  return engineRequest<{ crops: EngineCrop[] }>("/crops");
}

export function engineSoilVerdict(cropId: string, reading: EngineSoilReading) {
  return engineRequest<{ verdict: EngineSoilVerdict }>("/soil/verdict", { crop_id: cropId, reading });
}

export function engineEligibleCrops(reading: EngineSoilReading) {
  return engineRequest<{ verdicts: EngineSoilVerdict[] }>("/soil/eligible", { reading });
}

export function engineRotationCheck(prevId: string, nextId: string, yearsSince: number) {
  return engineRequest<{ check: EngineRotationCheck }>("/rotation/check", {
    prev_id: prevId,
    next_id: nextId,
    years_since: yearsSince,
  });
}

export function enginePairCheck(aId: string, bId: string) {
  return engineRequest<{ check: EnginePairCheck }>("/companion/pair", { a_id: aId, b_id: bId });
}

export function engineMixCheck(cropIds: string[]) {
  return engineRequest<{ check: EngineMixCheck }>("/companion/mix", { crop_ids: cropIds });
}
