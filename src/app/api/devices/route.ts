import { DeviceOwnership, DeviceStatus, UserRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { requireSessionUser } from "@/lib/auth";
import { createDeviceApiKey, hashDeviceApiKey } from "@/lib/device-credentials";
import { prisma } from "@/lib/prisma";

const ownerships = new Set(Object.values(DeviceOwnership));
const statuses = new Set(Object.values(DeviceStatus));

export async function GET() {
  try {
    const user = await requireSessionUser();
    if (user.role !== UserRole.ADMIN) return validationError("Only CropCycle service operations can manage devices.", 403);
    const [devices, farms, plots] = await Promise.all([
      prisma.device.findMany({
        include: {
          farm: { select: { farmCode: true, name: true } },
          plot: { select: { plotCode: true, name: true } },
          assignments: {
            where: { releasedAt: null },
            include: { farm: { select: { farmCode: true, name: true } }, plot: { select: { plotCode: true, name: true } } },
            take: 1,
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.farm.findMany({ select: { id: true, farmCode: true, name: true }, orderBy: { name: "asc" } }),
      prisma.plot.findMany({ select: { plotCode: true, farm: { select: { farmCode: true } }, name: true }, orderBy: { name: "asc" } }),
    ]);
    return NextResponse.json({
      devices: devices.map((device) => {
        const assignment = device.assignments[0];
        return {
          id: device.id,
          deviceCode: device.deviceCode,
          externalNodeId: device.externalNodeId ?? "",
          apiKeyConfigured: Boolean(device.apiKeyHash),
          type: device.type,
          status: device.status,
          ownership: device.ownership,
          firmware: device.firmware ?? "",
          lastConnectedAt: device.lastConnectedAt?.toISOString() ?? null,
          farmCode: assignment?.farm.farmCode ?? device.farm?.farmCode ?? "",
          farm: assignment?.farm.name ?? device.farm?.name ?? "",
          plotCode: assignment?.plot?.plotCode ?? device.plot?.plotCode ?? "",
          plot: assignment?.plot?.name ?? device.plot?.name ?? "",
        };
      }),
      farms,
      plots: plots.map(({ plotCode, farm, name }) => ({ plotCode, farmCode: farm.farmCode, name })),
      statuses: [...statuses],
      ownerships: [...ownerships],
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (user.role !== UserRole.ADMIN) return validationError("Only CropCycle service operations can register devices.", 403);
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return validationError("A valid JSON object is required.");
    const input = body as Record<string, unknown>;
    if (typeof input.deviceCode !== "string" || input.deviceCode.trim().length < 2 || input.deviceCode.trim().length > 100) {
      return validationError("Device code must be between 2 and 100 characters.");
    }
    if (typeof input.type !== "string" || input.type.trim().length < 2 || input.type.trim().length > 80) {
      return validationError("Device type must be between 2 and 80 characters.");
    }
    const ownership = input.ownership === undefined ? DeviceOwnership.CROPCYCLE : input.ownership;
    if (typeof ownership !== "string" || !ownerships.has(ownership as DeviceOwnership)) {
      return validationError("Choose a valid device ownership type.");
    }
    if (input.firmware !== undefined && (typeof input.firmware !== "string" || input.firmware.length > 80)) {
      return validationError("Firmware version must be 80 characters or fewer.");
    }
    if (input.externalNodeId !== undefined &&
      (typeof input.externalNodeId !== "string" || input.externalNodeId.trim().length > 100)) {
      return validationError("SheetDB Node ID must be 100 characters or fewer.");
    }
    const deviceCode = input.deviceCode.trim();
    const type = input.type.trim();

    let farm: { id: string } | null = null;
    let plot: { id: string } | null = null;
    if (input.farmCode !== undefined && input.farmCode !== "") {
      if (typeof input.farmCode !== "string") return validationError("Choose a valid farm.");
      farm = await prisma.farm.findUnique({ where: { farmCode: input.farmCode }, select: { id: true } });
      if (!farm) return validationError("Farm not found.", 404);
      if (input.plotCode !== undefined && input.plotCode !== "") {
        if (typeof input.plotCode !== "string") return validationError("Choose a valid field.");
        plot = await prisma.plot.findFirst({ where: { plotCode: input.plotCode, farmId: farm.id }, select: { id: true } });
        if (!plot) return validationError("Field not found on the selected farm.", 404);
      }
    } else if (input.plotCode !== undefined && input.plotCode !== "") {
      return validationError("Choose a farm before assigning a field.");
    }

    const apiKey = createDeviceApiKey();
    const device = await prisma.$transaction(async (tx) => {
      const created = await tx.device.create({
        data: {
          deviceCode,
          apiKeyHash: hashDeviceApiKey(apiKey),
          type,
          externalNodeId: typeof input.externalNodeId === "string" ? input.externalNodeId.trim() || null : null,
          ownership: ownership as DeviceOwnership,
          firmware: typeof input.firmware === "string" && input.firmware.trim() ? input.firmware.trim() : null,
          registeredById: user.id,
          farmId: farm?.id,
          plotId: plot?.id,
        },
      });
      if (farm) {
        await tx.deviceAssignment.create({
          data: { deviceId: created.id, farmId: farm.id, plotId: plot?.id },
        });
      }
      return created;
    });
    return NextResponse.json(
      { id: device.id, deviceCode: device.deviceCode, apiKey },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
