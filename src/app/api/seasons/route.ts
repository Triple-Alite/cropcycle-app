import { CropRecordType, Prisma, SeasonStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { requireSessionUser } from "@/lib/auth";
import { farmWhere, farmingMethod, farmingMethodLabel, hasFarmPermission, isFarmingMethod } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

function stringList(value: unknown) {
  if (typeof value !== "string") return [];
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))].slice(0, 40);
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return validationError("A valid JSON object is required.");
    const input = body as Record<string, unknown>;
    if (typeof input.plotCode !== "string") return validationError("Choose a plot for this season.");
    if (typeof input.name !== "string" || input.name.trim().length < 2 || input.name.trim().length > 120) {
      return validationError("Season name must be between 2 and 120 characters.");
    }
    if (!isFarmingMethod(input.method) || !isFarmingMethod(input.preferredMethod)) {
      return validationError("Choose valid farming method preferences.");
    }
    const plot = await prisma.plot.findFirst({
      where: { plotCode: input.plotCode, farm: { is: farmWhere(user) } },
      include: { farm: { select: { id: true } } },
    });
    if (!plot) return validationError("Plot not found or not accessible.", 404);
    if (!await hasFarmPermission(user, plot.farmId, "canManageSeasons")) {
      return validationError("You do not have permission to manage seasons on this farm.", 403);
    }

    const previous = stringList(input.previousCrops);
    if (!previous.length) {
      const recentSeasons = await prisma.season.findMany({
        where: { farmId: plot.farmId, plotId: plot.id },
        include: { crops: { where: { recordType: { in: [CropRecordType.ACTUAL, CropRecordType.INTENDED] } } } },
        orderBy: { createdAt: "desc" },
        take: 5,
      });
      for (const priorSeason of recentSeasons) {
        for (const crop of priorSeason.crops) {
          if (!previous.includes(crop.name)) previous.push(crop.name);
        }
      }
    }
    const intended = stringList(input.intendedCrops);
    const available = stringList(input.available);
    const marketable = stringList(input.market);
    const allCrops = [
      ...previous.map((name) => ({ name, recordType: CropRecordType.PREVIOUS })),
      ...intended.map((name) => ({ name, recordType: CropRecordType.INTENDED })),
    ];
    const season = await prisma.season.create({
      data: {
        farmId: plot.farmId,
        plotId: plot.id,
        name: input.name.trim(),
        farmingMethod: farmingMethod(input.method),
        status: SeasonStatus.PLANNING,
        crops: { create: allCrops },
        requirement: {
          create: {
            intendedCrops: intended,
            availableCrops: available,
            marketableCrops: marketable,
            preferredMethod: input.preferredMethod === undefined || input.preferredMethod === null
              ? null
              : farmingMethod(input.preferredMethod),
            otherRequirements: input.otherRequirements && typeof input.otherRequirements === "object"
              ? input.otherRequirements as Prisma.InputJsonValue
              : Prisma.JsonNull,
          },
        },
      },
      include: {
        farm: { select: { farmCode: true, name: true } },
        plot: { select: { plotCode: true, name: true } },
        crops: true,
        requirement: true,
      },
    });
    return NextResponse.json({
      season: {
        id: season.id,
        farmId: season.farm.farmCode,
        plotId: season.plot.plotCode,
        farm: season.farm.name,
        plot: season.plot.name,
        name: season.name,
        crop: intended.join(" + ") || "Not recorded",
        previousCrops: previous,
        available: available.join(", "),
        market: marketable.join(", "),
        method: farmingMethodLabel(season.farmingMethod),
        status: "Planning",
      },
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
