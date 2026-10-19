import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { requireSessionUser } from "@/lib/auth";
import { importSheetDbReadings } from "@/lib/sheetdb-sync";
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
    if (user.role !== UserRole.ADMIN) {
      return validationError("Only CropCycle service operations can sync SheetDB readings.", 403);
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
