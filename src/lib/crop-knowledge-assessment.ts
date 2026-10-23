import knowledgeBase from "@/lib/crop-knowledge-base.json";
import { SeasonRecommendationContext } from "@/lib/recommendation-engine";

type SoilValues = SeasonRecommendationContext["soil"];
type Suitability = "supported" | "review-needed" | "insufficient-data" | "unsuitable";
type SoilParameterField = "moisture" | "pH" | "electricalConductivity" |
  "nitrogen" | "phosphorus" | "potassium" | "soilTemperature";

const sourceVersion = Number(knowledgeBase.source.version.replace(".", ""));
const sourceCitation = knowledgeBase.source.citation;
const parameterFields: Record<string, SoilParameterField> = {
  moisture: "moisture",
  pH: "pH",
  temperature: "soilTemperature",
  EC: "electricalConductivity",
  N: "nitrogen",
  P: "phosphorus",
  K: "potassium",
};
const parameterNames: Record<string, string> = {
  moisture: "soil moisture",
  pH: "soil pH",
  temperature: "soil temperature",
  EC: "electrical conductivity",
  N: "nitrogen",
  P: "phosphorus",
  K: "potassium",
};

function matchesCrop(names: string[], crop: string) {
  return names.some((name) => name.trim().toLocaleLowerCase() === crop.toLocaleLowerCase());
}

export function assessCropKnowledgeBase(
  soil: SoilValues,
  previousCrops: string[],
  seasonName: string,
) {
  const results = knowledgeBase.crops.map((crop) => {
    const ranges = knowledgeBase.soilRanges.filter((range) => range.cropId === crop.id);
    const reasons = new Set<string>();
    const considerations = new Set<string>();
    const rotationAdjustment = { value: 0 };
    let idealMatches = 0;
    let toleranceMatches = 0;
    let hasMissingRequiredData = false;
    let hasHardGateFailure = false;
    let needsAmendment = false;

    for (const range of ranges) {
      const field = parameterFields[range.parameter];
      if (!field) continue;
      const value = soil[field];
      if (value === null) {
        if (range.gate === "HARD") {
          hasMissingRequiredData = true;
          considerations.add(`${parameterNames[range.parameter]} is not available; a soil test is needed before confirming suitability.`);
        }
        continue;
      }

      if (range.idealMin !== null && range.idealMax !== null &&
        value >= range.idealMin && value <= range.idealMax) {
        idealMatches += 1;
        toleranceMatches += 1;
        reasons.add(`${parameterNames[range.parameter]} (${value}) is within the ideal range (${range.idealMin}–${range.idealMax} ${range.unit}).`);
        continue;
      }
      if (value >= range.tolerableMin && value <= range.tolerableMax) {
        toleranceMatches += 1;
        if (range.gate === "HARD") {
          considerations.add(`${parameterNames[range.parameter]} is tolerable but outside the ideal range (${range.idealMin}–${range.idealMax} ${range.unit}).`);
        } else if (value < range.idealMin) {
          needsAmendment = true;
          considerations.add(`${parameterNames[range.parameter]} is below the ideal range; amend only with soil-test and local extension guidance.`);
        } else {
          considerations.add(`${parameterNames[range.parameter]} is above the ideal range; do not add more of this nutrient.`);
        }
        continue;
      }

      if (range.gate === "HARD") {
        hasHardGateFailure = true;
        considerations.add(`${parameterNames[range.parameter]} (${value}) is outside the tolerable range (${range.tolerableMin}–${range.tolerableMax} ${range.unit}); this crop is not suitable as-is.`);
      } else if (value < range.tolerableMin) {
        needsAmendment = true;
        considerations.add(`${parameterNames[range.parameter]} is below the tolerable range; amend first and retest.`);
      } else {
        considerations.add(`${parameterNames[range.parameter]} is above the tolerable maximum; do not add more of this nutrient.`);
      }
    }

    const previousCropNames = [...new Set(previousCrops.map((name) => name.trim()).filter(Boolean))];
    previousCropNames.some((previousCrop) => {
      const rotation = knowledgeBase.rotations.find((entry) =>
        entry.crop.toLocaleLowerCase() === previousCrop.toLocaleLowerCase(),
      );
      if (!rotation) return false;
      const neverAfter = typeof rotation.neverAfter === "string"
        ? rotation.neverAfter.split(",").map((name) => name.trim()).filter(Boolean)
        : [];
      if (matchesCrop(neverAfter, crop.name)) {
        hasHardGateFailure = true;
        considerations.add(`The workbook's strict rotation rule does not allow ${crop.name} after ${previousCrop}: ${rotation.reason}`);
        return true;
      }
      const goodAfter = typeof rotation.goodAfter === "string"
        ? rotation.goodAfter.split(",").map((name) => name.trim()).filter(Boolean)
        : [];
      const poorAfter = typeof rotation.poorAfter === "string"
        ? rotation.poorAfter.split(",").map((name) => name.trim()).filter(Boolean)
        : [];
      if (matchesCrop(goodAfter, crop.name)) {
        rotationAdjustment.value += 2;
        reasons.add(`The workbook rates ${crop.name} as a good rotation after ${previousCrop}.`);
      } else if (matchesCrop(poorAfter, crop.name)) {
        rotationAdjustment.value -= 2;
        considerations.add(`The workbook advises against rotating ${previousCrop} to ${crop.name}: ${rotation.reason}`);
      }
      return false;
    });

    const seasonLabel = seasonName.toLocaleLowerCase();
    const plantingWindow = crop.growingWindow.toLocaleLowerCase();
    if (
      (seasonLabel.includes("dry") && plantingWindow.includes("rainy season only")) ||
      ((seasonLabel.includes("rain") || seasonLabel.includes("wet")) &&
        plantingWindow.includes("dry season") && !plantingWindow.includes("both"))
    ) {
      considerations.add(`The workbook lists this crop for a different growing window (${crop.growingWindow}); confirm irrigation and planting timing before selection.`);
    }
    considerations.add(`Scientist's planting window: ${crop.plantingWindow}. Confirm the season and irrigation locally.`);
    if (crop.notes) considerations.add(crop.notes);
    considerations.add("This workbook is a Minna, Niger State edition; confirm its ranges and crop assumptions with a local extension officer before planting.");
    considerations.add("Companion-crop compatibility and multi-year rotation intervals are not fully assessed from the available season record.");

    const suitability: Suitability = hasHardGateFailure
      ? "unsuitable"
      : hasMissingRequiredData
        ? "insufficient-data"
        : needsAmendment
          ? "review-needed"
          : "supported";

    return {
      crop: crop.name,
      suitability,
      reasons: [...reasons],
      alternatives: [],
      considerations: [...considerations],
      knowledge: [{
        id: `crop-knowledge-base-${knowledgeBase.source.version.replace(".", "-")}`,
        title: knowledgeBase.source.title,
        source: sourceCitation,
        version: sourceVersion,
      }],
      rank: idealMatches * 100 + toleranceMatches * 10 + rotationAdjustment.value,
      hardGateFailure: hasHardGateFailure,
    };
  });

  const statusOrder: Record<Suitability, number> = {
    supported: 0,
    "review-needed": 1,
    "insufficient-data": 2,
    unsuitable: 3,
  };
  const candidates = results
    .sort((left, right) =>
      statusOrder[left.suitability] - statusOrder[right.suitability] ||
      right.rank - left.rank ||
      left.crop.localeCompare(right.crop),
    )
    .map((candidate) => ({
      crop: candidate.crop,
      suitability: candidate.suitability,
      reasons: candidate.reasons,
      alternatives: candidate.alternatives,
      considerations: candidate.considerations,
      knowledge: candidate.knowledge,
    }));

  return {
    notice: `Provisional crop shortlist based on the crop scientist's knowledge base and the latest synced soil reading. The sensor does not provide pH or electrical conductivity (EC), so candidates are unconfirmed until these hard-gate measurements are checked. Sensor NPK and moisture values are indicative; confirm with a soil test. Companion-crop compatibility and full multi-year rotation history are not assessed. ${sourceCitation}`,
    candidates,
  };
}
