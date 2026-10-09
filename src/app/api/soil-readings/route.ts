import { randomUUID } from "node:crypto";
import { SyncStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { requireSessionUser } from "@/lib/auth";
import { farmWhere, hasFarmPermission } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

function isValidSensorValue(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000;
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return validationError("A valid JSON object is required.");
    const input = body as Record<string, unknown>;
    if (typeof input.plotCode !== "string" || typeof input.seasonId !== "string") {
      return validationError("Choose a plot and season for this reading.");
    }
    const plot = await prisma.plot.findFirst({
      where: { plotCode: input.plotCode, farm: { is: farmWhere(user) } },
      include: { farm: { select: { id: true, ownerFarmerId: true } } },
    });
    if (!plot) return validationError("Plot not found or not accessible.", 404);
    if (!await hasFarmPermission(user, plot.farmId, "canRecordSoil")) {
      return validationError("You do not have permission to record soil readings on this farm.", 403);
    }
    const season = await prisma.season.findFirst({
      where: { id: input.seasonId, farmId: plot.farmId, plotId: plot.id },
      select: { id: true },
    });
    if (!season) return validationError("Season does not belong to the selected plot.", 400);

    const values = {
      nitrogen: input.nitrogen,
      phosphorus: input.phosphorus,
      potassium: input.potassium,
      soilTemperature: input.soilTemperature,
      humidity: input.humidity,
    } as const;
    if (
      !isValidSensorValue(values.nitrogen) ||
      !isValidSensorValue(values.phosphorus) ||
      !isValidSensorValue(values.potassium) ||
      typeof values.soilTemperature !== "number" ||
      !Number.isFinite(values.soilTemperature) ||
      values.soilTemperature < -50 ||
      values.soilTemperature > 100 ||
      typeof values.humidity !== "number" ||
      !Number.isFinite(values.humidity) ||
      values.humidity < 0 ||
      values.humidity > 100
    ) {
      return validationError("Record N, P and K as non-negative values, soil temperature from -50 to 100 °C, and humidity from 0 to 100%.");
    }
    const idempotencyKey = typeof input.idempotencyKey === "string"
      ? input.idempotencyKey
      : randomUUID();
    if (idempotencyKey.length < 8 || idempotencyKey.length > 100) {
      return validationError("Reading idempotency key must be between 8 and 100 characters.");
    }
    const recordedAt = input.recordedAt === undefined ? undefined : new Date(String(input.recordedAt));
    if (input.recordedAt !== undefined && !Number.isFinite(recordedAt?.getTime())) {
      return validationError("Reading timestamp is invalid.");
    }
    let deviceId: string | null = null;
    if (typeof input.deviceId === "string" && input.deviceId.trim()) {
      const device = await prisma.device.findFirst({
        where: {
          deviceCode: input.deviceId.trim(),
          status: "ACTIVE",
          OR: [
            { farmId: plot.farmId, plotId: plot.id },
            { assignments: { some: { farmId: plot.farmId, plotId: plot.id, releasedAt: null } } },
          ],
        },
        select: { id: true },
      });
      if (!device) return validationError("Active sensor is not assigned to this plot.", 400);
      deviceId = device.id;
    }
    const existingReading = await prisma.soilReading.findUnique({
      where: { idempotencyKey },
      select: {
        id: true,
        farmId: true,
        plotId: true,
        seasonId: true,
        deviceId: true,
        nitrogen: true,
        phosphorus: true,
        potassium: true,
        soilTemperature: true,
        humidity: true,
        recordedAt: true,
        syncStatus: true,
      },
    });
    if (existingReading) {
      const same =
        existingReading.farmId === plot.farmId &&
        existingReading.plotId === plot.id &&
        existingReading.seasonId === season.id &&
        existingReading.deviceId === deviceId &&
        existingReading.nitrogen !== null && Number(existingReading.nitrogen) === values.nitrogen &&
        existingReading.phosphorus !== null && Number(existingReading.phosphorus) === values.phosphorus &&
        existingReading.potassium !== null && Number(existingReading.potassium) === values.potassium &&
        existingReading.soilTemperature !== null && Number(existingReading.soilTemperature) === values.soilTemperature &&
        existingReading.humidity !== null && Number(existingReading.humidity) === values.humidity &&
        (!recordedAt || existingReading.recordedAt.getTime() === recordedAt.getTime());
      if (!same) return validationError("Reading idempotency key is already used for different data.", 409);
      return NextResponse.json({
        reading: { id: existingReading.id, sync: existingReading.syncStatus },
      });
    }
    const reading = await prisma.soilReading.create({
      data: {
        idempotencyKey,
        farmerId: plot.farm.ownerFarmerId,
        farmId: plot.farmId,
        plotId: plot.id,
        seasonId: season.id,
        deviceId,
        nitrogen: values.nitrogen,
        phosphorus: values.phosphorus,
        potassium: values.potassium,
        soilTemperature: values.soilTemperature,
        humidity: values.humidity,
        recordedAt,
        syncStatus: SyncStatus.SYNCED,
        confirmedAt: new Date(),
      },
    });
    return NextResponse.json({ reading: { id: reading.id, sync: reading.syncStatus } }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
