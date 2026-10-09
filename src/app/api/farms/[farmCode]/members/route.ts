import { FarmMemberRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { requireSessionUser } from "@/lib/auth";
import { farmWhere, hasFarmPermission } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

const roles = new Set(Object.values(FarmMemberRole));
const permissionKeys = [
  "canManageFarm",
  "canManagePlots",
  "canManageSeasons",
  "canRecordSoil",
  "canViewRecommendations",
] as const;

type Permission = (typeof permissionKeys)[number];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ farmCode: string }> },
) {
  try {
    const actor = await requireSessionUser();
    const { farmCode } = await params;
    const farm = await prisma.farm.findFirst({
      where: { farmCode, ...farmWhere(actor) },
      select: { id: true },
    });
    if (!farm) return validationError("Farm not found or not accessible.", 404);
    if (!await hasFarmPermission(actor, farm.id, "canManageFarm")) {
      return validationError("You do not have permission to manage this farm's members.", 403);
    }

    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return validationError("A valid JSON object is required.");
    const { userId, role, permissions } = body as Record<string, unknown>;
    if (typeof userId !== "string" || userId.length > 64) {
      return validationError("A valid user ID is required.");
    }
    if (typeof role !== "string" || !roles.has(role as FarmMemberRole)) {
      return validationError("Choose a valid farm membership role.");
    }
    if (permissions !== undefined && (!permissions || typeof permissions !== "object" || Array.isArray(permissions))) {
      return validationError("Permissions must be an object.");
    }
    const customPermissions = (permissions ?? {}) as Record<string, unknown>;
    for (const key of permissionKeys) {
      if (customPermissions[key] !== undefined && typeof customPermissions[key] !== "boolean") {
        return validationError(`${key} must be true or false.`);
      }
    }
    const target = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, disabledAt: true },
    });
    if (!target || target.disabledAt) return validationError("Active user not found.", 404);

    const roleDefaults: Record<FarmMemberRole, Record<Permission, boolean>> = {
      OWNER: {
        canManageFarm: true,
        canManagePlots: true,
        canManageSeasons: true,
        canRecordSoil: true,
        canViewRecommendations: true,
      },
      FARM_MANAGER: {
        canManageFarm: true,
        canManagePlots: true,
        canManageSeasons: true,
        canRecordSoil: true,
        canViewRecommendations: true,
      },
      FIELD_WORKER: {
        canManageFarm: false,
        canManagePlots: false,
        canManageSeasons: false,
        canRecordSoil: true,
        canViewRecommendations: true,
      },
      AGRADAR_AGENT: {
        canManageFarm: false,
        canManagePlots: true,
        canManageSeasons: true,
        canRecordSoil: true,
        canViewRecommendations: true,
      },
    };
    const memberRole = role as FarmMemberRole;
    const resolvedPermissions = Object.fromEntries(
      permissionKeys.map((key) => [key, customPermissions[key] ?? roleDefaults[memberRole][key]]),
    ) as Record<Permission, boolean>;
    const membership = await prisma.farmMembership.upsert({
      where: { farmId_userId: { farmId: farm.id, userId: target.id } },
      create: { farmId: farm.id, userId: target.id, role: memberRole, ...resolvedPermissions },
      update: { role: memberRole, ...resolvedPermissions },
      select: {
        id: true,
        userId: true,
        role: true,
        canManageFarm: true,
        canManagePlots: true,
        canManageSeasons: true,
        canRecordSoil: true,
        canViewRecommendations: true,
      },
    });
    return NextResponse.json({ membership }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
