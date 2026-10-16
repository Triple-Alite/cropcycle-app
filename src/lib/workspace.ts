import { FarmingMethod, Prisma, UserRole } from "@prisma/client";
import { SessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export function isAdministrator(user: SessionUser) {
  return user.role === UserRole.ADMIN;
}

function normalizeFarmingMethod(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "not-recorded";
  if (value === FarmingMethod.MONO_CROPPING) return "mono-cropping";
  if (value === FarmingMethod.MIXED_FARMING) return "mixed-farming";
  if (value === FarmingMethod.NOT_RECORDED) return "not-recorded";
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (!normalized) return "not-recorded";
  if (normalized === "mono cropping" || normalized === "monocropping") return "mono-cropping";
  if (normalized === "mixed farming" || normalized === "mixedfarming") return "mixed-farming";
  if (normalized === "not recorded" || normalized === "notrecorded") return "not-recorded";
  return normalized;
}

export function farmingMethod(value: unknown): FarmingMethod {
  const normalized = normalizeFarmingMethod(value);
  if (normalized === "mono-cropping") return FarmingMethod.MONO_CROPPING;
  if (normalized === "mixed-farming") return FarmingMethod.MIXED_FARMING;
  if (normalized === "not-recorded") return FarmingMethod.NOT_RECORDED;
  throw new Error("Farming method is invalid.");
}

export function isFarmingMethod(value: unknown) {
  const normalized = normalizeFarmingMethod(value);
  return normalized === "not-recorded" || normalized === "mono-cropping" || normalized === "mixed-farming";
}

export function farmingMethodLabel(value: FarmingMethod) {
  if (value === FarmingMethod.MONO_CROPPING) return "Mono-cropping";
  if (value === FarmingMethod.MIXED_FARMING) return "Mixed farming";
  return "Not recorded";
}

export function farmerWhere(user: SessionUser): Prisma.FarmerWhereInput {
  if (isAdministrator(user)) return {};
  if (user.role === UserRole.FARMER) return { userId: user.id };
  if (user.role === UserRole.CROP_SCIENTIST) return { id: "__no_farmer_access__" };
  return {
    OR: [
      { createdById: user.id },
      { userId: user.id },
      { farms: { some: { memberships: { some: { userId: user.id } } } } },
    ],
  };
}

export function farmWhere(user: SessionUser): Prisma.FarmWhereInput {
  if (isAdministrator(user)) return {};
  if (user.role === UserRole.CROP_SCIENTIST) return { id: "__no_farm_access__" };
  return {
    OR: [
      { owner: { userId: user.id } },
      { owner: { createdById: user.id } },
      { memberships: { some: { userId: user.id } } },
    ],
  };
}

export function recommendationWhere(user: SessionUser): Prisma.RecommendationWhereInput {
  if (user.role === UserRole.ADMIN) return {};
  if (user.role === UserRole.CROP_SCIENTIST) {
    return { status: "NEEDS_REVIEW" };
  }
  if (user.role === UserRole.FARMER) {
    return {
      status: "SHARED",
      farm: { owner: { userId: user.id } },
    };
  }
  return {
    status: "SHARED",
    OR: [
      { farm: { owner: { createdById: user.id } } },
      { farm: { owner: { userId: user.id } } },
      { farm: { memberships: { some: { userId: user.id, canViewRecommendations: true } } } },
    ],
  };
}

export async function hasFarmPermission(
  user: SessionUser,
  farmId: string,
  permission: "canManageFarm" | "canManagePlots" | "canManageSeasons" | "canRecordSoil" | "canViewRecommendations",
) {
  if (isAdministrator(user)) return true;
  const farm = await prisma.farm.findFirst({
    where: { id: farmId, ...farmWhere(user) },
    select: {
      owner: { select: { userId: true, createdById: true } },
      memberships: {
        where: { userId: user.id },
        select: {
          canManageFarm: true,
          canManagePlots: true,
          canManageSeasons: true,
          canRecordSoil: true,
          canViewRecommendations: true,
        },
      },
    },
  });
  if (!farm) return false;
  if (farm.owner.userId === user.id) return true;
  if (user.role === UserRole.FIELD_AGENT && farm.owner.createdById === user.id) return true;
  return farm.memberships.some((membership) => membership[permission]);
}

export function publicRole(role: UserRole) {
  return role
    .toLowerCase()
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

export const farmerSelect = {
  id: true,
  farmerCode: true,
  name: true,
  phone: true,
  location: true,
  farmingMethod: true,
} satisfies Prisma.FarmerSelect;

export const farmInclude = {
  owner: { select: farmerSelect },
  _count: { select: { plots: true } },
} satisfies Prisma.FarmInclude;

export const plotInclude = {
  farm: { select: { id: true, farmCode: true, name: true } },
} satisfies Prisma.PlotInclude;

export const seasonInclude = {
  farm: { select: { id: true, farmCode: true, name: true } },
  plot: { select: { id: true, plotCode: true, name: true } },
  crops: { select: { name: true, recordType: true } },
  requirement: true,
} satisfies Prisma.SeasonInclude;
