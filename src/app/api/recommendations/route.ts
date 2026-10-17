import { FarmingMethod, Prisma, RecommendationStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { requireSessionUser } from "@/lib/auth";
import {
  assessCropsWithEngine,
  EngineRequestError,
  engineSoilReading,
  EngineUnavailableError,
  SeasonRecommendationContext,
} from "@/lib/recommendation-engine";
import { farmWhere, farmingMethodLabel, hasFarmPermission, recommendationWhere } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const user = await requireSessionUser();
    const recommendations = await prisma.recommendation.findMany({
      where: recommendationWhere(user),
      include: {
        farm: { select: { farmCode: true, name: true } },
        plot: { select: { plotCode: true, name: true } },
        season: { select: { name: true } },
        knowledgeRules: {
          include: {
            knowledgeRule: {
              select: { id: true, key: true, version: true, title: true, sourceCitation: true, body: true },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ recommendations });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || !("seasonId" in body) || typeof body.seasonId !== "string") {
      return validationError("Choose a season to review.");
    }
    const season = await prisma.season.findFirst({
      where: {
        id: body.seasonId,
        farm: { is: farmWhere(user) },
      },
      include: {
        farm: {
          include: {
            owner: {
              select: { id: true, location: true },
            },
          },
        },
        plot: { select: { id: true, plotCode: true, name: true } },
        crops: { select: { name: true, recordType: true } },
        requirement: true,
      },
    });
    if (!season) return validationError("Season not found or not accessible.", 404);
    if (!await hasFarmPermission(user, season.farmId, "canViewRecommendations")) {
      return validationError("You do not have permission to assess this farm's recommendations.", 403);
    }

    const reading = await prisma.soilReading.findFirst({
      where: { farmId: season.farmId, plotId: season.plotId, seasonId: season.id },
      orderBy: { recordedAt: "desc" },
      select: {
        moisture: true,
        pH: true,
        nitrogen: true,
        phosphorus: true,
        potassium: true,
        soilTemperature: true,
        humidity: true,
        recordedAt: true,
      },
    });

    const context: SeasonRecommendationContext = {
      seasonId: season.id,
      seasonName: season.name,
      farmId: season.farm.farmCode,
      farmName: season.farm.name,
      farmerId: season.farm.owner.id,
      plotId: season.plot.plotCode,
      plotName: season.plot.name,
      location: season.farm.location ?? season.farm.owner.location,
      farmingMethod: season.farmingMethod,
      preferredMethod: season.requirement?.preferredMethod ?? null,
      otherRequirements: season.requirement?.otherRequirements === null ||
        season.requirement?.otherRequirements === undefined
        ? null
        : JSON.stringify(season.requirement.otherRequirements),
      intendedCrops: season.requirement?.intendedCrops ?? season.crops
        .filter((crop) => crop.recordType === "INTENDED")
        .map((crop) => crop.name),
      availableCrops: season.requirement?.availableCrops ?? [],
      marketableCrops: season.requirement?.marketableCrops ?? [],
      previousCrops: season.crops
        .filter((crop) => crop.recordType === "PREVIOUS" || crop.recordType === "ACTUAL")
        .map((crop) => crop.name),
      soil: {
        nitrogen: reading?.nitrogen === null || reading?.nitrogen === undefined ? null : Number(reading.nitrogen),
        phosphorus: reading?.phosphorus === null || reading?.phosphorus === undefined ? null : Number(reading.phosphorus),
        potassium: reading?.potassium === null || reading?.potassium === undefined ? null : Number(reading.potassium),
        soilTemperature: reading?.soilTemperature === null || reading?.soilTemperature === undefined ? null : Number(reading.soilTemperature),
        humidity: reading?.humidity === null || reading?.humidity === undefined ? null : Number(reading.humidity),
        recordedAt: reading?.recordedAt.toISOString() ?? null,
      },
    };
    const engineReading = engineSoilReading(reading);
    // Rotation is checked only against crops grown before this season;
    // ACTUAL crops are this season's own plantings.
    const rotationPreviousCrops = season.crops
      .filter((crop) => crop.recordType === "PREVIOUS")
      .map((crop) => crop.name);
    const soilSnapshot = {
      ...context.soil,
      moisture: engineReading.moisture,
      pH: engineReading.ph,
    };

    // No fallback: if the engine cannot assess, nothing is saved.
    let assessment: Awaited<ReturnType<typeof assessCropsWithEngine>>;
    try {
      assessment = await assessCropsWithEngine({
        candidateCrops: [...context.intendedCrops, ...context.availableCrops, ...context.marketableCrops],
        intendedCrops: context.intendedCrops,
        previousCrops: rotationPreviousCrops,
        mixedFarming: context.farmingMethod === FarmingMethod.MIXED_FARMING,
        reading: engineReading,
      });
    } catch (error) {
      if (error instanceof EngineUnavailableError) {
        console.error("CropCycle engine unavailable:", error);
        return NextResponse.json({
          error: "The recommendation engine is currently unavailable. No recommendation was created. Please try again.",
          code: error.code,
          retryable: error.retryable,
        }, { status: 503 });
      }
      if (error instanceof EngineRequestError) {
        console.error("CropCycle engine rejected the request:", error.engineStatus, error.message);
        return NextResponse.json({
          error: "The recommendation engine could not assess this season. No recommendation was created.",
        }, { status: 500 });
      }
      throw error;
    }

    const noticeParts = assessment.candidates.length
      ? [
        `Assessed against the CropCycle crop knowledge base${assessment.kbVersion ? ` (version ${assessment.kbVersion})` : ""}.`,
        "Soil EC is not recorded yet and is not part of soil verdicts.",
        ...(assessment.mix && !assessment.mix.valid ? [`The planned crop mix is not valid: ${assessment.mix.reasons.join(" ")}`] : []),
        ...(assessment.unmappedPreviousCrops.length
          ? [`Previous crops not in the knowledge base were not rotation-checked: ${assessment.unmappedPreviousCrops.join(", ")}.`]
          : []),
        "This is decision-support, not a guarantee of yield or a substitute for local expert review.",
      ]
      : ["No intended, available, or marketable crops are recorded for this season. Add the farmer's crop requirements before requesting an assessment."];
    const result = {
      notice: noticeParts.join(" "),
      candidates: assessment.candidates,
      engine: {
        kbVersion: assessment.kbVersion,
        mix: assessment.mix,
        unmappedPreviousCrops: assessment.unmappedPreviousCrops,
      },
      dataUsed: {
        soil: soilSnapshot,
        previousCrops: rotationPreviousCrops,
        intendedCrops: context.intendedCrops,
        availableCrops: context.availableCrops,
        marketableCrops: context.marketableCrops,
        preferredMethod: context.preferredMethod
          ? farmingMethodLabel(context.preferredMethod)
          : null,
        otherRequirements: context.otherRequirements,
      },
    };

    const recommendation = await prisma.$transaction(async (tx) => {
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
          provider: "cropcycle-engine",
          modelVersion: assessment.kbVersion ?? "not-called",
          inputSnapshot: {
            seasonId: context.seasonId,
            seasonName: context.seasonName,
            farmId: context.farmId,
            farmName: context.farmName,
            farmerId: context.farmerId,
            plotId: context.plotId,
            plotName: context.plotName,
            location: context.location,
            farmingMethod: farmingMethodLabel(context.farmingMethod),
            preferredMethod: context.preferredMethod
              ? farmingMethodLabel(context.preferredMethod)
              : null,
            otherRequirements: context.otherRequirements,
            intendedCrops: context.intendedCrops,
            availableCrops: context.availableCrops,
            marketableCrops: context.marketableCrops,
            previousCrops: rotationPreviousCrops,
            soil: soilSnapshot,
            engineReading,
          },
          result,
        },
        include: {
          knowledgeRules: {
            include: {
              knowledgeRule: {
                select: { id: true, key: true, version: true, title: true, sourceCitation: true },
              },
            },
          },
        },
      });
    }, { isolationLevel: "Serializable" });

    return NextResponse.json({ recommendation, result }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return validationError("A recommendation was created at the same time. Refresh the history and try again.", 409);
    }
    return errorResponse(error);
  }
}
