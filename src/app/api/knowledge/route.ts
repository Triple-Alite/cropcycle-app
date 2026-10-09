import { KnowledgeStatus, Prisma, UserRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { parseKnowledgeBody, knowledgeKey } from "@/lib/agricultural-knowledge";
import { requireSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function canManageKnowledge(role: UserRole) {
  return role === UserRole.ADMIN || role === UserRole.CROP_SCIENTIST;
}

function activeWindow(now: Date): Prisma.KnowledgeRuleWhereInput {
  return {
    status: KnowledgeStatus.APPROVED,
    AND: [
      { OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }] },
      { OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
    ],
  };
}

export async function GET() {
  try {
    const user = await requireSessionUser();
    const rules = await prisma.knowledgeRule.findMany({
      where: canManageKnowledge(user.role) ? undefined : activeWindow(new Date()),
      select: {
        id: true,
        key: true,
        version: true,
        title: true,
        body: true,
        sourceCitation: true,
        status: true,
        effectiveFrom: true,
        effectiveTo: true,
        approvedAt: true,
        createdAt: true,
      },
      orderBy: [{ key: "asc" }, { version: "desc" }],
    });
    return NextResponse.json({ rules });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!canManageKnowledge(user.role)) {
      return validationError("Only Crop Scientists and administrators can draft agricultural knowledge.", 403);
    }
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return validationError("A valid JSON object is required.");
    const input = body as Record<string, unknown>;
    if (typeof input.title !== "string" || input.title.trim().length < 3 || input.title.trim().length > 200) {
      return validationError("Knowledge title must be between 3 and 200 characters.");
    }
    if (typeof input.sourceCitation !== "string" || input.sourceCitation.trim().length < 4 || input.sourceCitation.length > 4000) {
      return validationError("Add a complete source citation (4–4000 characters).");
    }
    const title = input.title.trim();
    const sourceCitation = input.sourceCitation.trim();
    const parsed = parseKnowledgeBody(input.body);
    if (!parsed.ok) return validationError(parsed.error);

    const key = knowledgeKey(parsed.body);
    const effectiveFrom = input.effectiveFrom ? new Date(String(input.effectiveFrom)) : null;
    const effectiveTo = input.effectiveTo ? new Date(String(input.effectiveTo)) : null;
    if ((effectiveFrom && Number.isNaN(effectiveFrom.getTime())) ||
        (effectiveTo && Number.isNaN(effectiveTo.getTime())) ||
        (effectiveFrom && effectiveTo && effectiveFrom >= effectiveTo)) {
      return validationError("Enter a valid effective date range.");
    }
    const rule = await prisma.$transaction(async (tx) => {
      const latest = await tx.knowledgeRule.aggregate({
        where: { key },
        _max: { version: true },
      });
      return tx.knowledgeRule.create({
        data: {
          key,
          version: (latest._max.version ?? 0) + 1,
          title,
          body: parsed.json,
          sourceCitation,
          createdById: user.id,
          effectiveFrom,
          effectiveTo,
        },
      });
    }, { isolationLevel: "Serializable" });
    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
