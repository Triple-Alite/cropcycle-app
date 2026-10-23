import { FarmingMethod } from "@prisma/client";
import { StructuredKnowledgeBody } from "@/lib/agricultural-knowledge";

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
    moisture: number | null;
    pH: number | null;
    electricalConductivity: number | null;
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
