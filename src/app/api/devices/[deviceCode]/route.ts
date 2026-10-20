import { DeviceOwnership, DeviceStatus, UserRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { requireSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const statuses = new Set(Object.values(DeviceStatus));
const ownerships = new Set(Object.values(DeviceOwnership));

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ deviceCode: string }> },
) {
  try {
    const user = await requireSessionUser();
    if (user.role !== UserRole.ADMIN) return validationError("Only CropCycle service operations can update devices.", 403);
    const { deviceCode } = await params;
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return validationError("A valid JSON object is required.");
    const input = body as Record<string, unknown>;
    const device = await prisma.device.findUnique({ where: { deviceCode }, select: { id: true } });
    if (!device) return validationError("Device not found.", 404);
    const data: {
      status?: DeviceStatus;
      ownership?: DeviceOwnership;
      firmware?: string | null;
      externalNodeId?: string | null;
      farmId?: string | null;
      plotId?: string | null;
    } = {};

    if (input.status !== undefined) {
      if (typeof input.status !== "string" || !statuses.has(input.status as DeviceStatus)) {
        return validationError("Choose a valid device status.");
      }
      data.status = input.status as DeviceStatus;
    }
    if (input.ownership !== undefined) {
      if (typeof input.ownership !== "string" || !ownerships.has(input.ownership as DeviceOwnership)) {
        return validationError("Choose a valid ownership type.");
      }
      data.ownership = input.ownership as DeviceOwnership;
    }
    if (input.firmware !== undefined) {
      if (typeof input.firmware !== "string" || input.firmware.length > 80) {
        return validationError("Firmware version must be 80 characters or fewer.");
      }
      data.firmware = input.firmware.trim() || null;
    }
    if (input.externalNodeId !== undefined) {
      if (typeof input.externalNodeId !== "string" || input.externalNodeId.trim().length > 100) {
        return validationError("SheetDB Node ID must be 100 characters or fewer.");
      }
      data.externalNodeId = input.externalNodeId.trim() || null;
    }

    let nextFarmId: string | null | undefined;
    let nextPlotId: string | null | undefined;
    let assignmentChanged = false;
    if (input.farmCode !== undefined) {
      assignmentChanged = true;
      if (input.farmCode === null || input.farmCode === "") {
        nextFarmId = null;
        nextPlotId = null;
      } else if (typeof input.farmCode !== "string") {
        return validationError("Choose a valid farm.");
      } else {
        const farm = await prisma.farm.findUnique({ where: { farmCode: input.farmCode }, select: { id: true } });
        if (!farm) return validationError("Farm not found.", 404);
        nextFarmId = farm.id;
        nextPlotId = null;
        if (input.plotCode !== undefined && input.plotCode !== "") {
          if (typeof input.plotCode !== "string") return validationError("Choose a valid field.");
          const plot = await prisma.plot.findFirst({ where: { plotCode: input.plotCode, farmId: farm.id }, select: { id: true } });
          if (!plot) return validationError("Field not found on the selected farm.", 404);
          nextPlotId = plot.id;
        }
      }

    } else if (input.plotCode !== undefined) {
      if (input.plotCode === null || input.plotCode === "") {
        assignmentChanged = true;
        nextPlotId = null;
      } else if (typeof input.plotCode !== "string") {
        return validationError("Choose a valid field.");
      } else {
        const plot = await prisma.plot.findUnique({
          where: { plotCode: input.plotCode },
          select: { id: true, farmId: true },
        });
        if (!plot) return validationError("Field not found.", 404);
        nextFarmId = plot.farmId;
        nextPlotId = plot.id;
        assignmentChanged = true;
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (assignmentChanged) {
        await tx.deviceAssignment.updateMany({
          where: { deviceId: device.id, releasedAt: null },
          data: { releasedAt: new Date() },
        });
        if (nextFarmId) {
          await tx.deviceAssignment.create({
            data: { deviceId: device.id, farmId: nextFarmId, plotId: nextPlotId ?? null },
          });
        }
        data.farmId = nextFarmId ?? null;
        data.plotId = nextPlotId ?? null;
      }
      return tx.device.update({ where: { id: device.id }, data, select: { deviceCode: true, status: true, externalNodeId: true } });
    });
    return NextResponse.json({ device: updated });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ deviceCode: string }> },
) {
  try {
    const user = await requireSessionUser();
    if (user.role !== UserRole.ADMIN) return validationError("Only CropCycle service operations can delete devices.", 403);

    const { deviceCode } = await params;
    const device = await prisma.device.findUnique({
      where: { deviceCode },
      select: { id: true, deviceCode: true },
    });
    if (!device) return validationError("Device not found.", 404);

    await prisma.device.delete({ where: { id: device.id } });
    return NextResponse.json({ ok: true, deviceCode: device.deviceCode });
  } catch (error) {
    return errorResponse(error);
  }
}
