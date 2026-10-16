import { Prisma, SeasonStatus, SyncStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { hashDeviceApiKey } from "@/lib/device-credentials";
import { prisma } from "@/lib/prisma";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export async function POST(request: NextRequest) {
  try {
    const authorization = request.headers.get("authorization");
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{40,100})$/);
    if (!match) return validationError("A valid device bearer token is required.", 401);

    const device = await prisma.device.findUnique({
      where: { apiKeyHash: hashDeviceApiKey(match[1]) },
      select: {
        id: true,
        deviceCode: true,
        status: true,
        farmId: true,
        plotId: true,
        assignments: {
          where: { releasedAt: null },
          orderBy: { assignedAt: "desc" },
          take: 1,
          select: { farmId: true, plotId: true },
        },
      },
    });
    if (!device) return validationError("Device credentials are invalid.", 401);
    if (device.status !== "ACTIVE") return validationError("This device is not active.", 403);

    const body: unknown = await request.json();
    if (!isRecord(body)) return validationError("A valid JSON object is required.");
    const { readingId, recordedAt, nitrogen, phosphorus, potassium, soilTemperature, humidity } = body;
    if (typeof readingId !== "string" || readingId.trim().length < 8 || readingId.trim().length > 100) {
      return validationError("readingId must be a stable ID between 8 and 100 characters.");
    }
    if (
      typeof nitrogen !== "number" || !Number.isFinite(nitrogen) || nitrogen < 0 || nitrogen > 1_000_000 ||
      typeof phosphorus !== "number" || !Number.isFinite(phosphorus) || phosphorus < 0 || phosphorus > 1_000_000 ||
      typeof potassium !== "number" || !Number.isFinite(potassium) || potassium < 0 || potassium > 1_000_000 ||
      typeof soilTemperature !== "number" || !Number.isFinite(soilTemperature) || soilTemperature < -50 || soilTemperature > 100 ||
      typeof humidity !== "number" || !Number.isFinite(humidity) || humidity < 0 || humidity > 100
    ) {
      return validationError("Sensor values are invalid. N, P and K must be 0–1,000,000 ppm, temperature -50–100 °C, and humidity 0–100%.");
    }
    let timestamp: Date | undefined;
    if (recordedAt !== undefined) {
      if (typeof recordedAt !== "string" || !Number.isFinite(Date.parse(recordedAt))) {
        return validationError("recordedAt must be a valid ISO 8601 timestamp.");
      }
      timestamp = new Date(recordedAt);
      if (timestamp.getTime() > Date.now() + 5 * 60 * 1000) {
        return validationError("recordedAt cannot be more than 5 minutes in the future.");
      }
    }

    const assignment = device.assignments[0];
    const farmId = assignment?.farmId ?? device.farmId;
    const plotId = assignment?.plotId ?? device.plotId;
    if (!farmId || !plotId) {
      return validationError("Assign this device to a farm field before sending readings.", 409);
    }
    const plot = await prisma.plot.findFirst({
      where: { id: plotId, farmId },
      select: { id: true, farmId: true, farm: { select: { ownerFarmerId: true } } },
    });
    if (!plot) return validationError("The device's assigned field no longer exists. Reassign the device before sending readings.", 409);
    const key = readingId.trim();
    const existing = await prisma.soilReading.findUnique({
      where: { idempotencyKey: key },
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
      },
    });
    if (existing) {
      const same = existing.farmId === farmId &&
        existing.plotId === plot.id &&
        existing.deviceId === device.id &&
        existing.nitrogen !== null && Number(existing.nitrogen) === nitrogen &&
        existing.phosphorus !== null && Number(existing.phosphorus) === phosphorus &&
        existing.potassium !== null && Number(existing.potassium) === potassium &&
        existing.soilTemperature !== null && Number(existing.soilTemperature) === soilTemperature &&
        existing.humidity !== null && Number(existing.humidity) === humidity &&
        (!timestamp || existing.recordedAt.getTime() === timestamp.getTime());
      if (!same) return validationError("readingId has already been used for different data.", 409);
      await prisma.device.update({ where: { id: device.id }, data: { lastConnectedAt: new Date() } });
      return NextResponse.json({ status: "duplicate", readingId: existing.id, recordedAt: existing.recordedAt.toISOString() });
    }

    const activeSeason = await prisma.season.findFirst({
      where: { farmId, plotId, status: SeasonStatus.ACTIVE },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    const season = activeSeason ?? await prisma.season.findFirst({
      where: { farmId, plotId, status: SeasonStatus.PLANNING },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!season) return validationError("There is no active or planned season for the assigned field.", 409);

    const readingTime = timestamp ?? new Date();
    const reading = await prisma.$transaction(async (tx) => {
      const created = await tx.soilReading.create({
        data: {
          idempotencyKey: key,
          farmerId: plot.farm.ownerFarmerId,
          farmId,
          plotId: plot.id,
          seasonId: season.id,
          deviceId: device.id,
          nitrogen,
          phosphorus,
          potassium,
          soilTemperature,
          humidity,
          recordedAt: readingTime,
          syncStatus: SyncStatus.SYNCED,
          confirmedAt: new Date(),
        },
        select: { id: true, recordedAt: true },
      });
      await tx.device.update({ where: { id: device.id }, data: { lastConnectedAt: new Date() } });
      return created;
    });
    return NextResponse.json({
      status: "accepted",
      readingId: reading.id,
      deviceCode: device.deviceCode,
      recordedAt: reading.recordedAt.toISOString(),
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return validationError("readingId was submitted concurrently. Retry with the same readingId.", 409);
    }
    return errorResponse(error);
  }
}
