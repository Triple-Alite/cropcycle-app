import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { requireSessionUser } from "@/lib/auth";
import { farmWhere, hasFarmPermission } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return validationError("A valid JSON object is required.");
    const input = body as Record<string, unknown>;
    if (typeof input.farmCode !== "string") return validationError("Choose a farm for this plot.");
    if (typeof input.name !== "string" || input.name.trim().length < 1 || input.name.trim().length > 160) {
      return validationError("Plot name must be between 1 and 160 characters.");
    }
    const area = Number(input.area);
    if (!Number.isFinite(area) || area <= 0 || area > 1_000_000) {
      return validationError("Plot area must be greater than zero.");
    }
    const farm = await prisma.farm.findFirst({
      where: { farmCode: input.farmCode, ...farmWhere(user) },
      select: { id: true, name: true },
    });
    if (!farm) return validationError("Farm not found or not accessible.", 404);
    if (!await hasFarmPermission(user, farm.id, "canManagePlots")) {
      return validationError("You do not have permission to manage plots on this farm.", 403);
    }
    const latitude = input.latitude === undefined || input.latitude === "" ? null : Number(input.latitude);
    const longitude = input.longitude === undefined || input.longitude === "" ? null : Number(input.longitude);
    if ((latitude !== null && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
        (longitude !== null && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
      return validationError("Enter valid GPS coordinates.");
    }
    const plot = await prisma.plot.create({
      data: {
        farmId: farm.id,
        plotCode: `AGR-PL-${randomBytes(5).toString("hex").toUpperCase()}`,
        name: input.name.trim(),
        areaHectares: new Prisma.Decimal(area),
        location: typeof input.location === "string" ? input.location.trim() : null,
        latitude: latitude === null ? null : new Prisma.Decimal(latitude),
        longitude: longitude === null ? null : new Prisma.Decimal(longitude),
      },
    });
    return NextResponse.json({
      plot: {
        id: plot.plotCode,
        farmId: input.farmCode,
        farm: farm.name,
        name: plot.name,
        area: Number(plot.areaHectares ?? 0),
        location: plot.location ?? "",
        latitude: plot.latitude === null ? undefined : Number(plot.latitude),
        longitude: plot.longitude === null ? undefined : Number(plot.longitude),
      },
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
