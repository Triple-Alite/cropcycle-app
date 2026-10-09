import { KnowledgeStatus, UserRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { parseKnowledgeBody, knowledgeKey } from "@/lib/agricultural-knowledge";
import { requireSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function canManageKnowledge(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.CROP_SCIENTIST;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ knowledgeId: string }> },
) {
  try {
    const user = await requireSessionUser();
    if (!canManageKnowledge(user.role)) {
      return validationError("Only Crop Scientists and administrators can review agricultural knowledge.", 403);
    }
    const { knowledgeId } = await params;
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return validationError("A valid JSON object is required.");
    const input = body as Record<string, unknown>;
    const rule = await prisma.knowledgeRule.findUnique({ where: { id: knowledgeId } });
    if (!rule) return validationError("Knowledge rule not found.", 404);

    if (input.action === "retire") {
      if (rule.status !== KnowledgeStatus.APPROVED) {
        return validationError("Only approved rules can be retired.", 409);
      }
      const retired = await prisma.knowledgeRule.update({
        where: { id: rule.id },
        data: {
          status: KnowledgeStatus.RETIRED,
          effectiveTo: rule.effectiveFrom && rule.effectiveFrom > new Date()
            ? rule.effectiveFrom
            : new Date(),
        },
      });
      return NextResponse.json({ rule: retired });
    }

    if (input.action === "approve") {
      if (rule.status !== KnowledgeStatus.DRAFT) {
        return validationError("Only draft rules can be approved.", 409);
      }
      const parsed = parseKnowledgeBody(rule.body);
      if (!parsed.ok || knowledgeKey(parsed.body) !== rule.key) {
        return validationError("Rule contents are invalid or no longer match their version key.", 409);
      }
      const now = new Date();
      const effectiveFrom = rule.effectiveFrom ?? now;
      if (rule.effectiveTo && rule.effectiveTo <= effectiveFrom) {
        return validationError("The effective end date must be later than the start date.");
      }
      const approved = await prisma.$transaction(async (tx) => {
        const approvedVersions = await tx.knowledgeRule.findMany({
          where: {
            key: rule.key,
            status: KnowledgeStatus.APPROVED,
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
          },
          select: { id: true, effectiveFrom: true },
        });
        const futureOverlap = approvedVersions.find((version) =>
          version.effectiveFrom &&
          version.effectiveFrom >= effectiveFrom &&
          (!rule.effectiveTo || version.effectiveFrom < rule.effectiveTo),
        );
        if (futureOverlap) {
          return null;
        }
        const supersededIds = approvedVersions
          .filter((version) => !version.effectiveFrom || version.effectiveFrom < effectiveFrom)
          .map((version) => version.id);
        if (supersededIds.length) {
          await tx.knowledgeRule.updateMany({
            where: { id: { in: supersededIds } },
            data: { effectiveTo: effectiveFrom },
          });
        }
        return tx.knowledgeRule.update({
          where: { id: rule.id },
          data: {
            status: KnowledgeStatus.APPROVED,
            approvedById: user.id,
            approvedAt: now,
            effectiveFrom,
          },
        });
      }, { isolationLevel: "Serializable" });
      if (!approved) {
        return validationError(
          "An approved future version overlaps this rule's effective date range.",
          409,
        );
      }
      return NextResponse.json({ rule: approved });
    }

    if (input.action !== "update") {
      return validationError("Action must be update, approve, or retire.");
    }
    if (rule.status !== KnowledgeStatus.DRAFT) {
      return validationError("Approved knowledge is immutable. Create a new version instead.", 409);
    }
    if (
      typeof input.title !== "string" ||
      input.title.trim().length < 3 ||
      input.title.trim().length > 200 ||
      typeof input.sourceCitation !== "string" ||
      input.sourceCitation.trim().length < 4 ||
      input.sourceCitation.length > 4000
    ) {
      return validationError("Provide a valid title and source citation.");
    }
    const parsed = parseKnowledgeBody(input.body);
    if (!parsed.ok) return validationError(parsed.error);
    if (knowledgeKey(parsed.body) !== rule.key) {
      return validationError("Crop and region identify a rule version and cannot change during editing.");
    }
    const effectiveFrom = input.effectiveFrom ? new Date(String(input.effectiveFrom)) : null;
    const effectiveTo = input.effectiveTo ? new Date(String(input.effectiveTo)) : null;
    if ((effectiveFrom && Number.isNaN(effectiveFrom.getTime())) ||
        (effectiveTo && Number.isNaN(effectiveTo.getTime())) ||
        (effectiveFrom && effectiveTo && effectiveFrom >= effectiveTo)) {
      return validationError("Enter a valid effective date range.");
    }
    const updated = await prisma.knowledgeRule.update({
      where: { id: rule.id },
      data: {
        title: input.title.trim(),
        sourceCitation: input.sourceCitation.trim(),
        body: parsed.json,
        effectiveFrom,
        effectiveTo,
      },
    });
    return NextResponse.json({ rule: updated });
  } catch (error) {
    return errorResponse(error);
  }
}
