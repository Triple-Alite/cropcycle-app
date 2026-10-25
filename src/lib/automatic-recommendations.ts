import { Prisma, RecommendationStatus, SyncStatus } from "@prisma/client";
import { assessCropKnowledgeBase } from "@/lib/crop-knowledge-assessment";
import { prisma } from "@/lib/prisma";
import { farmingMethodLabel } from "@/lib/workspace";

function hasSameReadingSnapshot(snapshot: Prisma.JsonValue, recordedAt: string) {
  if (typeof snapshot !== "object" || snapshot === null || Array.isArray(snapshot)) return false;
  const soil = snapshot.soil;
  return typeof soil === "object" &&
    soil !== null &&
    !Array.isArray(soil) &&
    soil.recordedAt === recordedAt;
}

export async function prepareAutomaticRecommendation(
  seasonId: string,
  expectedReadingKey?: string,
) {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: {
      farm: {
        include: {
          owner: { select: { id: true, location: true } },
        },
      },
      plot: { select: { id: true, plotCode: true, name: true } },
      crops: { select: { name: true, recordType: true } },
      requirement: true,
    },
  });
  if (!season) return { status: "season-not-found" as const };
  if (season.status !== "ACTIVE" && season.status !== "PLANNING") {
    return { status: "season-inactive" as const };
  }

  const reading = await prisma.soilReading.findFirst({
    where: {
      farmId: season.farmId,
      plotId: season.plotId,
      seasonId: season.id,
      syncStatus: SyncStatus.SYNCED,
    },
    orderBy: { recordedAt: "desc" },
    select: {
      idempotencyKey: true,
      moisture: true,
      nitrogen: true,
      phosphorus: true,
      potassium: true,
      soilTemperature: true,
      humidity: true,
      recordedAt: true,
    },
  });
  if (!reading) return { status: "reading-not-found" as const };
  if (expectedReadingKey && reading.idempotencyKey !== expectedReadingKey) {
    return { status: "newer-reading-exists" as const };
  }

  const previousCrops = season.crops
    .filter((crop) => crop.recordType === "PREVIOUS" || crop.recordType === "ACTUAL")
    .map((crop) => crop.name);
  const soil = {
    moisture: reading.moisture === null ? null : Number(reading.moisture),
    pH: null,
    electricalConductivity: null,
    nitrogen: reading.nitrogen === null ? null : Number(reading.nitrogen),
    phosphorus: reading.phosphorus === null ? null : Number(reading.phosphorus),
    potassium: reading.potassium === null ? null : Number(reading.potassium),
    soilTemperature: reading.soilTemperature === null ? null : Number(reading.soilTemperature),
    humidity: reading.humidity === null ? null : Number(reading.humidity),
    recordedAt: reading.recordedAt.toISOString(),
  };
  const assessment = assessCropKnowledgeBase(soil, previousCrops, season.name);
  const recommendation = await prisma.$transaction(async (tx) => {
    const existing = await tx.recommendation.findFirst({
      where: { seasonId: season.id },
      orderBy: { createdAt: "desc" },
      select: { inputSnapshot: true, provider: true },
    });
    if (
      existing?.provider === "cropcycle-crop-knowledge-base" &&
      hasSameReadingSnapshot(existing.inputSnapshot, soil.recordedAt)
    ) return null;

    const latest = await tx.recommendation.aggregate({
      where: { seasonId: season.id },
      _max: { version: true },
    });
    return tx.recommendation.create({
      data: {
        farmerId: season.farm.owner.id,
        farmId: season.farmId,
        plotId: season.plotId,
        seasonId: season.id,
        version: (latest._max.version ?? 0) + 1,
        status: RecommendationStatus.NEEDS_REVIEW,
        provider: "cropcycle-crop-knowledge-base",
        modelVersion: "crop-knowledge-base-1.1",
        inputSnapshot: {
          seasonId: season.id,
          seasonName: season.name,
          farmId: season.farm.farmCode,
          farmName: season.farm.name,
          farmerId: season.farm.owner.id,
          plotId: season.plot.plotCode,
          plotName: season.plot.name,
          location: season.farm.location ?? season.farm.owner.location,
          farmingMethod: farmingMethodLabel(season.farmingMethod),
          previousCrops,
          soil,
        },
        result: {
          notice: assessment.notice,
          candidates: assessment.candidates,
          dataUsed: {
            soil,
            previousCrops,
            intendedCrops: season.requirement?.intendedCrops ?? season.crops
              .filter((crop) => crop.recordType === "INTENDED")
              .map((crop) => crop.name),
            availableCrops: season.requirement?.availableCrops ?? [],
            marketableCrops: season.requirement?.marketableCrops ?? [],
            preferredMethod: season.requirement?.preferredMethod
              ? farmingMethodLabel(season.requirement.preferredMethod)
              : null,
            otherRequirements: season.requirement?.otherRequirements === null ||
              season.requirement?.otherRequirements === undefined
              ? null
              : JSON.stringify(season.requirement.otherRequirements),
          },
        },
      },
    });
  }, { isolationLevel: "Serializable" });

  return recommendation
    ? { status: "created" as const, recommendation }
    : { status: "already-assessed" as const };
}
