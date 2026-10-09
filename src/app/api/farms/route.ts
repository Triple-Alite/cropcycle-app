import { randomBytes } from "node:crypto";
import { Prisma, UserRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { requireSessionUser } from "@/lib/auth";
import { farmerWhere, farmingMethod, isFarmingMethod } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.FIELD_AGENT && user.role !== UserRole.FARMER) {
      return validationError("Your role cannot create farms.", 403);
    }
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return validationError("A valid JSON object is required.");
    const input = body as Record<string, unknown>;
    if (typeof input.name !== "string" || input.name.trim().length < 2 || input.name.trim().length > 160) {
      return validationError("Farm name must be between 2 and 160 characters.");
    }
    if (typeof input.ownerCode !== "string") return validationError("Choose a farmer who owns this farm.");
    if (input.location !== undefined && (typeof input.location !== "string" || input.location.length > 240)) {
      return validationError("Location must be 240 characters or fewer.");
    }
    if (!isFarmingMethod(input.farmingMethod)) {
      return validationError("Choose a valid farming method.");
    }
    const area = Number(input.area);
    if (!Number.isFinite(area) || area <= 0 || area > 1_000_000) {
      return validationError("Farm area must be greater than zero.");
    }
    const plotCount = input.plotCount === undefined ? 0 : Number(input.plotCount);
    if (!Number.isInteger(plotCount) || plotCount < 0 || plotCount > 100) {
      return validationError("Initial plot count must be between 0 and 100.");
    }
    const owner = await prisma.farmer.findFirst({
      where: {
        farmerCode: input.ownerCode,
        ...farmerWhere(user),
        ...(user.role === UserRole.FARMER ? { userId: user.id } : {}),
      },
      select: { id: true },
    });
    if (!owner) return validationError("Farmer not found or not accessible.", 404);

    const farm = await prisma.farm.create({
      data: {
        farmCode: `AGR-FM-${randomBytes(5).toString("hex").toUpperCase()}`,
        ownerFarmerId: owner.id,
        name: input.name.trim(),
        location: typeof input.location === "string" ? input.location.trim() : null,
        areaHectares: new Prisma.Decimal(area),
        farmingMethod: farmingMethod(input.farmingMethod),
        plots: plotCount
          ? {
              create: Array.from({ length: plotCount }, (_, index) => ({
                plotCode: `AGR-PL-${randomBytes(5).toString("hex").toUpperCase()}`,
                name: `Plot ${String(index + 1).padStart(2, "0")}`,
                areaHectares: new Prisma.Decimal(area / plotCount),
                location: typeof input.location === "string" ? input.location.trim() : null,
              })),
            }
          : undefined,
      },
      include: { _count: { select: { plots: true } }, owner: { select: { farmerCode: true } } },
    });
    return NextResponse.json({
      farm: {
        id: farm.farmCode,
        ownerId: farm.owner.farmerCode,
        name: farm.name,
        location: farm.location ?? "",
        area: Number(farm.areaHectares ?? 0),
        plots: farm._count.plots,
      },
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
