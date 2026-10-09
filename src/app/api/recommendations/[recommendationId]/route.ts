import { KnowledgeStatus, RecommendationStatus, UserRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { requireSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ recommendationId: string }> },
) {
  try {
    const user = await requireSessionUser();
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.CROP_SCIENTIST) {
      return validationError("Only a Crop Scientist or administrator can review recommendations.", 403);
    }
    const { recommendationId } = await params;
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || !("action" in body) || typeof body.action !== "string") {
      return validationError("Choose approve or share.");
    }
    const recommendation = await prisma.recommendation.findFirst({
      where: { id: recommendationId },
      include: {
        knowledgeRules: {
          include: {
            knowledgeRule: {
              select: { status: true, effectiveFrom: true, effectiveTo: true },
            },
          },
        },
      },
    });
    if (!recommendation) return validationError("Recommendation not found or not accessible.", 404);

    if (body.action === "approve") {
      if (recommendation.status !== RecommendationStatus.NEEDS_REVIEW) {
        return validationError("Only assessments awaiting review can be approved.", 409);
      }
      const currentTime = new Date();
      const currentKnowledge = recommendation.knowledgeRules.every(({ knowledgeRule }) =>
        knowledgeRule.status === KnowledgeStatus.APPROVED &&
        (!knowledgeRule.effectiveFrom || knowledgeRule.effectiveFrom <= currentTime) &&
        (!knowledgeRule.effectiveTo || knowledgeRule.effectiveTo > currentTime)
      );
      if (!currentKnowledge) {
        return validationError("One or more knowledge sources have expired or been retired. Generate a fresh assessment.", 409);
      }
      const result = recommendation.result;
      if (
        !result ||
        typeof result !== "object" ||
        !("candidates" in result) ||
        !Array.isArray(result.candidates) ||
        !result.candidates.some((candidate) =>
          candidate !== null &&
          typeof candidate === "object" &&
          "suitability" in candidate &&
          candidate.suitability === "supported"
        )
      ) {
        return validationError("Review the evidence and record a soil reading before approving a supported crop assessment.", 409);
      }
      const approved = await prisma.recommendation.update({
        where: { id: recommendation.id },
        data: {
          status: RecommendationStatus.APPROVED,
          reviewedById: user.id,
          reviewedAt: currentTime,
        },
      });
      return NextResponse.json({ recommendation: approved });
    }
    if (body.action === "share") {
      if (recommendation.status !== RecommendationStatus.APPROVED) {
        return validationError("Only reviewed and approved assessments can be shared.", 409);
      }
      const shared = await prisma.recommendation.update({
        where: { id: recommendation.id },
        data: { status: RecommendationStatus.SHARED },
      });
      return NextResponse.json({ recommendation: shared });
    }
    return validationError("Action must be approve or share.");
  } catch (error) {
    return errorResponse(error);
  }
}
