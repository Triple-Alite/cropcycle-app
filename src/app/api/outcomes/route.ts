import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { cropOptionsError, parseCropSelections } from "@/lib/crops";
import { requireSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { farmWhere, hasFarmPermission } from "@/lib/workspace";

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return validationError("A valid JSON object is required.");
    }

    const input = body as Record<string, unknown>;
    if (typeof input.seasonId !== "string" || !input.seasonId.trim()) {
      return validationError("Choose the season this outcome belongs to.");
    }
    const actualCrops = parseCropSelections(input.actualCrops);
    if (!actualCrops?.length) {
      return validationError(cropOptionsError());
    }

    const yieldQuantity = input.yieldQuantity;
    if (yieldQuantity !== undefined && (
      typeof yieldQuantity !== "number" || !Number.isFinite(yieldQuantity) || yieldQuantity < 0
    )) {
      return validationError("Yield quantity must be a non-negative number.");
    }
    const yieldUnit = typeof input.yieldUnit === "string" ? input.yieldUnit.trim() : "";
    if (yieldUnit.length > 40 || (yieldQuantity !== undefined && !yieldUnit)) {
      return validationError("Provide a yield unit no longer than 40 characters when recording a yield.");
    }
    const notes = typeof input.notes === "string" ? input.notes.trim() : "";
    if (notes.length > 10_000) return validationError("Outcome notes must be 10,000 characters or fewer.");

    const rating = input.rating;
    if (rating !== undefined && (
      typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5
    )) {
      return validationError("Feedback rating must be a whole number from 1 to 5.");
    }
    const comment = typeof input.comment === "string" ? input.comment.trim() : "";
    if (comment.length > 10_000) return validationError("Feedback must be 10,000 characters or fewer.");

    const season = await prisma.season.findUnique({
      where: { id: input.seasonId },
      select: { id: true, farmId: true, plotId: true, farm: { select: { ownerFarmerId: true } } },
    });
    if (!season) return validationError("Season not found.", 404);
    if (!await hasFarmPermission(user, season.farmId, "canManageSeasons")) {
      return validationError("You do not have permission to record outcomes for this farm.", 403);
    }

    let recommendationId: string | undefined;
    if (input.recommendationId !== undefined && input.recommendationId !== "") {
      if (typeof input.recommendationId !== "string") {
        return validationError("Recommendation is invalid.");
      }
      const recommendation = await prisma.recommendation.findFirst({
        where: {
          id: input.recommendationId,
          seasonId: season.id,
          farmId: season.farmId,
          plotId: season.plotId,
        },
        select: { id: true },
      });
      if (!recommendation) {
        return validationError("Recommendation does not belong to the selected season.", 400);
      }
      recommendationId = recommendation.id;
    }

    const outcome = await prisma.$transaction(async (tx) => {
      const savedOutcome = await tx.outcome.create({
        data: {
          farmerId: season.farm.ownerFarmerId,
          farmId: season.farmId,
          plotId: season.plotId,
          seasonId: season.id,
          recommendationId,
          actualCrops,
          yieldQuantity,
          yieldUnit: yieldUnit || undefined,
          notes: notes || undefined,
        },
      });
      await tx.seasonCrop.createMany({
        data: actualCrops.map((name) => ({ seasonId: season.id, name, recordType: "ACTUAL" })),
        skipDuplicates: true,
      });
      if (rating !== undefined || comment) {
        await tx.feedback.create({
          data: {
            farmerId: savedOutcome.farmerId,
            outcomeId: savedOutcome.id,
            recommendationId,
            recordedById: user.id,
            rating,
            comment: comment || undefined,
          },
        });
      }
      return savedOutcome;
    });

    return NextResponse.json({ outcome }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET() {
  try {
    const user = await requireSessionUser();
    const outcomes = await prisma.outcome.findMany({
      where: { farm: { is: farmWhere(user) } },
      include: {
        farm: { select: { farmCode: true, name: true } },
        plot: { select: { plotCode: true, name: true } },
        season: { select: { id: true, name: true } },
        recommendation: { select: { id: true, version: true } },
        feedback: {
          select: { id: true, rating: true, comment: true, createdAt: true },
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { recordedAt: "desc" },
      take: 50,
    });
    return NextResponse.json({ outcomes });
  } catch (error) {
    return errorResponse(error);
  }
}
