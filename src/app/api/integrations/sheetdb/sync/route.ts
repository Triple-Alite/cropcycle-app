import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { requireSessionUser } from "@/lib/auth";
import { importSheetDbReadings } from "@/lib/sheetdb-sync";
import { hasFarmPermission } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";
import { UserRole } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasValidCronSecret(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization?.startsWith("Bearer ")) return false;
  const provided = Buffer.from(authorization.slice(7));
  const expected = Buffer.from(secret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

async function sync(nodeId?: string) {
  try {
    return NextResponse.json(await importSheetDbReadings(nodeId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return validationError("A valid JSON object is required.");
    }
    const input = body as Record<string, unknown>;
    if (input.deviceId === undefined) {
      if (user.role !== UserRole.ADMIN) {
        return validationError("Choose one of your farm's registered devices to sync.", 400);
      }
      return await sync();
    }
    if (typeof input.deviceId !== "string" || !input.deviceId.trim()) {
      return validationError("A valid device must be selected.");
    }

    const device = await prisma.device.findUnique({
      where: { id: input.deviceId.trim() },
      select: {
        externalNodeId: true,
        status: true,
        farmId: true,
        assignments: {
          where: { releasedAt: null },
          orderBy: { assignedAt: "desc" },
          take: 1,
          select: { farmId: true },
        },
      },
    });
    const farmId = device?.assignments[0]?.farmId ?? device?.farmId;
    if (!device || device.status !== "ACTIVE" || !device.externalNodeId || !farmId) {
      return validationError("This device is inactive, has no SheetDB Node ID, or is not assigned to a farm.", 409);
    }
    if (user.role !== UserRole.ADMIN && !await hasFarmPermission(user, farmId, "canRecordSoil")) {
      return validationError("You do not have permission to sync readings for this device's farm.", 403);
    }
    return await sync(device.externalNodeId);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: NextRequest) {
  if (!hasValidCronSecret(request)) {
    return validationError("A valid cron authorization token is required.", 401);
  }
  return sync();
}
