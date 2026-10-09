import { KnowledgeStatus, Prisma, RecommendationStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { parseKnowledgeBody } from "@/lib/agricultural-knowledge";
import { errorResponse, validationError } from "@/lib/api";
import { requireSessionUser } from "@/lib/auth";
import { ActiveRule, assessCrops, SeasonRecommendationContext } from "@/lib/recommendation-engine";
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

    const [reading, approvedRules] = await Promise.all([
      prisma.soilReading.findFirst({
        where: { farmId: season.farmId, plotId: season.plotId, seasonId: season.id },
        orderBy: { recordedAt: "desc" },
        select: {
          nitrogen: true,
          phosphorus: true,
          potassium: true,
          soilTemperature: true,
          humidity: true,
          recordedAt: true,
        },
      }),
      prisma.knowledgeRule.findMany({
        where: {
          status: KnowledgeStatus.APPROVED,
          AND: [
            { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: new Date() } }] },
            { OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }] },
          ],
        },
        select: {
          id: true,
          key: true,
          version: true,
          title: true,
          body: true,
          sourceCitation: true,
        },
        orderBy: [{ key: "asc" }, { version: "desc" }],
      }),
    ]);

    const activeRules: ActiveRule[] = [];
    const seenKeys = new Set<string>();
    for (const rule of approvedRules) {
      if (seenKeys.has(rule.key)) continue;
      seenKeys.add(rule.key);
      const parsed = parseKnowledgeBody(rule.body);
      if (!parsed.ok) {
        console.error("Skipping invalid approved agricultural knowledge rule:", rule.id, parsed.error);
        continue;
      }
      activeRules.push({
        id: rule.id,
        key: rule.key,
        version: rule.version,
        title: rule.title,
        sourceCitation: rule.sourceCitation,
        body: parsed.body,
      });
    }

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
    const result = assessCrops(context, activeRules);
    const citedRuleIds = new Set(
      result.candidates.flatMap((candidate) => candidate.knowledge.map((rule) => rule.id)),
    );
    const citedRules = activeRules.filter((rule) => citedRuleIds.has(rule.id));

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
          provider: "cropcycle-approved-rules",
          modelVersion: "1",
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
            previousCrops: context.previousCrops,
            soil: {
              nitrogen: context.soil.nitrogen,
              phosphorus: context.soil.phosphorus,
              potassium: context.soil.potassium,
              soilTemperature: context.soil.soilTemperature,
              humidity: context.soil.humidity,
              recordedAt: context.soil.recordedAt,
            },
          },
          result: {
            notice: result.notice,
            candidates: result.candidates.map((candidate) => ({
              crop: candidate.crop,
              suitability: candidate.suitability,
              reasons: candidate.reasons,
              alternatives: candidate.alternatives,
              considerations: candidate.considerations,
              knowledge: candidate.knowledge.map((rule) => ({
                id: rule.id,
                title: rule.title,
                source: rule.source,
                version: rule.version,
              })),
            })),
            dataUsed: {
              soil: {
                nitrogen: context.soil.nitrogen,
                phosphorus: context.soil.phosphorus,
                potassium: context.soil.potassium,
                soilTemperature: context.soil.soilTemperature,
                humidity: context.soil.humidity,
                recordedAt: context.soil.recordedAt,
              },
              previousCrops: context.previousCrops,
              intendedCrops: context.intendedCrops,
              availableCrops: context.availableCrops,
              marketableCrops: context.marketableCrops,
              preferredMethod: context.preferredMethod
                ? farmingMethodLabel(context.preferredMethod)
                : null,
              otherRequirements: context.otherRequirements,
            },
          },
          knowledgeRules: citedRules.length
            ? { create: citedRules.map((rule) => ({ knowledgeRuleId: rule.id })) }
            : undefined,
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
