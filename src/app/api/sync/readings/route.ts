import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { requireSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { farmWhere, hasFarmPermission } from "@/lib/workspace";

type SyncItemResult = {
  idempotencyKey: string;
  status: "SYNCED" | "DUPLICATE" | "CONFLICT" | "FAILED";
  readingId?: string;
  message?: string;
};

type ReadingPayload = {
  idempotencyKey: string;
  plotCode: string;
  seasonId: string;
  deviceId?: string;
  nitrogen: number;
  phosphorus: number;
  potassium: number;
  soilTemperature: number;
  humidity: number;
  recordedAt?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseReading(value: unknown): ReadingPayload | string {
  if (!isRecord(value)) return "Reading must be a JSON object.";
  const { idempotencyKey, plotCode, seasonId, deviceId, nitrogen, phosphorus, potassium, soilTemperature, humidity, recordedAt } = value;
  if (
    typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 100 ||
    typeof plotCode !== "string" || !plotCode.trim() ||
    typeof seasonId !== "string" || !seasonId.trim()
  ) {
    return "A stable reading ID, plot and season are required.";
  }
  if (
    typeof nitrogen !== "number" || !Number.isFinite(nitrogen) || nitrogen < 0 || nitrogen > 1_000_000 ||
    typeof phosphorus !== "number" || !Number.isFinite(phosphorus) || phosphorus < 0 || phosphorus > 1_000_000 ||
    typeof potassium !== "number" || !Number.isFinite(potassium) || potassium < 0 || potassium > 1_000_000 ||
    typeof soilTemperature !== "number" || !Number.isFinite(soilTemperature) || soilTemperature < -50 || soilTemperature > 100 ||
    typeof humidity !== "number" || !Number.isFinite(humidity) || humidity < 0 || humidity > 100
  ) {
    return "Reading values are invalid. N, P and K must be non-negative; soil temperature must be -50–100 °C and humidity 0–100%.";
  }
  if (deviceId !== undefined && typeof deviceId !== "string") return "Device ID is invalid.";
  if (recordedAt !== undefined && (
    typeof recordedAt !== "string" || !Number.isFinite(Date.parse(recordedAt))
  )) {
    return "Reading timestamp is invalid.";
  }
  return {
    idempotencyKey,
    plotCode: plotCode.trim(),
    seasonId: seasonId.trim(),
    deviceId: typeof deviceId === "string" && deviceId.trim() ? deviceId.trim() : undefined,
    nitrogen,
    phosphorus,
    potassium,
    soilTemperature,
    humidity,
    recordedAt: typeof recordedAt === "string" ? recordedAt : undefined,
  };
}

function isSameReading(
  existing: { farmId: string; plotId: string; seasonId: string; deviceId: string | null; nitrogen: Prisma.Decimal | null; phosphorus: Prisma.Decimal | null; potassium: Prisma.Decimal | null; soilTemperature: Prisma.Decimal | null; humidity: Prisma.Decimal | null; recordedAt: Date },
  plot: { farmId: string; id: string },
  seasonId: string,
  deviceId: string | null,
  input: ReadingPayload,
) {
  return existing.farmId === plot.farmId &&
    existing.plotId === plot.id &&
    existing.seasonId === seasonId &&
    existing.deviceId === deviceId &&
    existing.nitrogen !== null && Number(existing.nitrogen) === input.nitrogen &&
    existing.phosphorus !== null && Number(existing.phosphorus) === input.phosphorus &&
    existing.potassium !== null && Number(existing.potassium) === input.potassium &&
    existing.soilTemperature !== null && Number(existing.soilTemperature) === input.soilTemperature &&
    existing.humidity !== null && Number(existing.humidity) === input.humidity &&
    (!input.recordedAt || existing.recordedAt.getTime() === new Date(input.recordedAt).getTime());
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body: unknown = await request.json();
    if (!isRecord(body) || !Array.isArray(body.readings)) {
      return validationError("Provide a readings array.");
    }
    if (body.readings.length < 1 || body.readings.length > 100) {
      return validationError("Sync between 1 and 100 readings per request.");
    }

    const results: SyncItemResult[] = [];
    for (const rawItem of body.readings) {
      const parsed = parseReading(rawItem);
      if (typeof parsed === "string") {
        results.push({
          idempotencyKey: isRecord(rawItem) && typeof rawItem.idempotencyKey === "string" ? rawItem.idempotencyKey : "",
          status: "FAILED",
          message: parsed,
        });
        continue;
      }
      const input = parsed;
      let expectedFarmId = "";
      let expectedPlotId = "";
      let expectedSeasonId = "";
      let expectedDeviceId: string | null = null;
      try {
        const plot = await prisma.plot.findFirst({
          where: { plotCode: input.plotCode, farm: { is: farmWhere(user) } },
          include: { farm: { select: { id: true, ownerFarmerId: true } } },
        });
        if (!plot || !await hasFarmPermission(user, plot.farmId, "canRecordSoil")) {
          results.push({ idempotencyKey: input.idempotencyKey, status: "FAILED", message: "Plot is not accessible for soil readings." });
          continue;
        }
        expectedFarmId = plot.farmId;
        expectedPlotId = plot.id;
        const season = await prisma.season.findFirst({
          where: { id: input.seasonId, farmId: plot.farmId, plotId: plot.id },
          select: { id: true },
        });
        if (!season) {
          results.push({ idempotencyKey: input.idempotencyKey, status: "FAILED", message: "Season does not belong to the selected plot." });
          continue;
        }
        expectedSeasonId = season.id;
        let deviceId: string | null = null;
        if (input.deviceId) {
          const device = await prisma.device.findFirst({
            where: {
              deviceCode: input.deviceId,
              status: "ACTIVE",
              OR: [
                { farmId: plot.farmId, plotId: plot.id },
                { assignments: { some: { farmId: plot.farmId, plotId: plot.id, releasedAt: null } } },
              ],
            },
            select: { id: true },
          });
          if (!device) {
            results.push({ idempotencyKey: input.idempotencyKey, status: "FAILED", message: "Active sensor is not assigned to this plot." });
            continue;
          }
          deviceId = device.id;
        }
        expectedDeviceId = deviceId;

        const existing = await prisma.soilReading.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
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
          const same = isSameReading(existing, plot, season.id, deviceId, input);
          results.push(same
            ? { idempotencyKey: input.idempotencyKey, status: "DUPLICATE", readingId: existing.id }
            : {
              idempotencyKey: input.idempotencyKey,
              status: "CONFLICT",
              message: "This reading ID already exists with different field or sensor values.",
            });
          continue;
        }

        const reading = await prisma.soilReading.create({
          data: {
            idempotencyKey: input.idempotencyKey,
            farmerId: plot.farm.ownerFarmerId,
            farmId: plot.farmId,
            plotId: plot.id,
            seasonId: season.id,
            deviceId,
            nitrogen: input.nitrogen,
            phosphorus: input.phosphorus,
            potassium: input.potassium,
            soilTemperature: input.soilTemperature,
            humidity: input.humidity,
            recordedAt: input.recordedAt ? new Date(input.recordedAt) : undefined,
            syncStatus: "SYNCED",
            confirmedAt: new Date(),
          },
          select: { id: true },
        });
        results.push({ idempotencyKey: input.idempotencyKey, status: "SYNCED", readingId: reading.id });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const existing = await prisma.soilReading.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
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
            const same = isSameReading(
              existing,
              { farmId: expectedFarmId, id: expectedPlotId },
              expectedSeasonId,
              expectedDeviceId,
              input,
            );
            results.push({
              idempotencyKey: input.idempotencyKey,
              status: same ? "DUPLICATE" : "CONFLICT",
              ...(same ? { readingId: existing.id } : {}),
              message: same ? undefined : "This reading ID was submitted concurrently with different data.",
            });
            continue;
          }
        }
        throw error;
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    return errorResponse(error);
  }
}
