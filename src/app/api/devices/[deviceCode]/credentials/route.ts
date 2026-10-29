import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { requireSessionUser } from "@/lib/auth";
import { createDeviceApiKey, hashDeviceApiKey } from "@/lib/device-credentials";
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ deviceCode: string }> },
) {
  try {
    const user = await requireSessionUser();
    if (user.role !== UserRole.ADMIN) return validationError("Only AgroGauge administrators can issue device credentials.", 403);
    const { deviceCode } = await params;
    const deviceExists = await prisma.device.findUnique({ where: { deviceCode }, select: { id: true } });
    if (!deviceExists) return validationError("Device not found.", 404);
    const apiKey = createDeviceApiKey();
    const device = await prisma.device.update({
      where: { deviceCode },
      data: { apiKeyHash: hashDeviceApiKey(apiKey) },
      select: { deviceCode: true },
    });
    return NextResponse.json({
      deviceCode: device.deviceCode,
      apiKey,
      warning: "This key is shown only once. Store it securely on the device.",
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
