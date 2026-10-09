import { FarmingMethod, Prisma } from "@prisma/client";

export type ValueRange = {
  min?: number;
  max?: number;
};

export type StructuredKnowledgeBody = {
  crop: string;
  region?: string;
  farmingMethods?: FarmingMethod[];
  soil?: {
    nitrogen?: ValueRange;
    phosphorus?: ValueRange;
    potassium?: ValueRange;
    soilTemperature?: ValueRange;
    humidity?: ValueRange;
  };
  avoidAfter?: string[];
  reasons: string[];
  considerations: string[];
  alternatives: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateRange(value: unknown, label: string): value is ValueRange {
  if (!isRecord(value)) return false;
  const hasMin = value.min !== undefined;
  const hasMax = value.max !== undefined;
  if (!hasMin && !hasMax) return false;
  if (hasMin && (typeof value.min !== "number" || !Number.isFinite(value.min))) return false;
  if (hasMax && (typeof value.max !== "number" || !Number.isFinite(value.max))) return false;
  if (hasMin && hasMax && Number(value.min) > Number(value.max)) return false;
  if ((label === "humidity") && ((hasMin && Number(value.min) < 0) || (hasMax && Number(value.max) > 100))) {
    return false;
  }
  if (
    ["nitrogen", "phosphorus", "potassium"].includes(label) &&
    ((hasMin && Number(value.min) < 0) || (hasMax && Number(value.max) > 1_000_000))
  ) {
    return false;
  }
  if (label === "soilTemperature" && ((hasMin && Number(value.min) < -50) || (hasMax && Number(value.max) > 100))) {
    return false;
  }
  return true;
}

function validateStringList(value: unknown, required: boolean, maxItems = 20): value is string[] {
  if (value === undefined && !required) return true;
  return Array.isArray(value) &&
    value.length <= maxItems &&
    (!required || value.length > 0) &&
    value.every((item) => typeof item === "string" && item.trim().length > 0 && item.length <= 300);
}

export function parseKnowledgeBody(value: unknown):
  | { ok: true; body: StructuredKnowledgeBody; json: Prisma.InputJsonObject }
  | { ok: false; error: string } {
  if (!isRecord(value)) return { ok: false, error: "Knowledge body must be a JSON object." };
  if (typeof value.crop !== "string" || value.crop.trim().length < 1 || value.crop.trim().length > 120) {
    return { ok: false, error: "Knowledge must identify one crop." };
  }
  if (value.region !== undefined &&
      (typeof value.region !== "string" || value.region.trim().length < 2 || value.region.length > 160)) {
    return { ok: false, error: "Region must be between 2 and 160 characters." };
  }
  if (!validateStringList(value.reasons, true) ||
      !validateStringList(value.considerations, true) ||
      !validateStringList(value.alternatives, false) ||
      !validateStringList(value.avoidAfter, false)) {
    return {
      ok: false,
      error: "Provide non-empty reasons and considerations, and valid optional crop lists (up to 20 items each).",
    };
  }

  let farmingMethods: FarmingMethod[] | undefined;
  if (value.farmingMethods !== undefined) {
    const methods = value.farmingMethods;
    const allowed = new Set<string>([FarmingMethod.MONO_CROPPING, FarmingMethod.MIXED_FARMING]);
    if (
      !Array.isArray(methods) ||
      methods.length === 0 ||
      !methods.every((method): method is FarmingMethod => typeof method === "string" && allowed.has(method))
    ) {
      return { ok: false, error: "Farming methods must contain mono-cropping or mixed-farming values." };
    }
    farmingMethods = methods;
  }

  let soil: StructuredKnowledgeBody["soil"];
  if (value.soil !== undefined) {
    if (!isRecord(value.soil)) return { ok: false, error: "Soil criteria must be an object." };
    soil = {};
    for (const name of ["nitrogen", "phosphorus", "potassium", "soilTemperature", "humidity"] as const) {
      const range = value.soil[name];
      if (range !== undefined) {
        if (!validateRange(range, name)) {
          return { ok: false, error: `Soil ${name} range is invalid.` };
        }
        soil[name] = range;
      }
    }
    if (Object.keys(soil).length === 0) return { ok: false, error: "Soil criteria must include at least one range." };
  }
  if (!soil && !farmingMethods?.length && !((value.avoidAfter as string[] | undefined)?.length)) {
    return { ok: false, error: "Add at least one soil, farming-method, or crop-history criterion for this rule." };
  }

  const body: StructuredKnowledgeBody = {
    crop: value.crop.trim(),
    reasons: (value.reasons as string[]).map((item) => item.trim()),
    considerations: (value.considerations as string[]).map((item) => item.trim()),
    alternatives: (value.alternatives as string[] | undefined)?.map((item) => item.trim()) ?? [],
    avoidAfter: (value.avoidAfter as string[] | undefined)?.map((item) => item.trim()) ?? [],
  };
  if (value.region !== undefined) body.region = (value.region as string).trim();
  if (farmingMethods) body.farmingMethods = farmingMethods;
  if (soil) body.soil = soil;
  return { ok: true, body, json: body as Prisma.InputJsonObject };
}

export function knowledgeKey(body: StructuredKnowledgeBody) {
  const slug = (value: string) => value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${slug(body.crop)}-${body.region ? slug(body.region) : "all-regions"}`;
}
