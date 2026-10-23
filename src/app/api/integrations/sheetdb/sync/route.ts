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

async function sync() {
  try {
    return NextResponse.json(await importSheetDbReadings(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST() {
  try {
    const user = await requireSessionUser();
    if (user.role === UserRole.ADMIN) return await sync();
    if (user.role !== UserRole.FARMER) {
      return validationError("Only administrators or farmers linked to the synced device can sync SheetDB readings.", 403);
    }

    const targetNodeId = process.env.SHEETDB_NODE_ID?.trim();
    if (!targetNodeId) {
      return validationError("SheetDB is not configured. Ask an administrator to set SHEETDB_NODE_ID.", 503);
    }
    const device = await prisma.device.findUnique({
      where: { externalNodeId: targetNodeId },
      select: {
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
    if (!farmId || !await hasFarmPermission(user, farmId, "canRecordSoil")) {
      return validationError("You must be linked to the farm assigned to the SheetDB device to sync its readings.", 403);
    }
    return await sync();
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
