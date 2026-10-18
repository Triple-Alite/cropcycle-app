import { UserRole, UserTimeFormat } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { requireSessionUser } from "@/lib/auth";
import { isFarmingMethod, farmingMethod } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return validationError("A valid JSON object is required.");
    }
    const input = body as Record<string, unknown>;
    const profileName = input.name;
    const profileBio = input.bio;
    const notifications = input.emailNotifications;
    const timeFormat = input.timeFormat;
    const phone = input.phone;
    const location = input.location;
    const farmingValue = input.farming;
    const profilePhone = typeof phone === "string" ? phone.trim() : "";
    const profileLocation = typeof location === "string" ? location.trim() : "";
    const farmer = await prisma.farmer.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (user.role === UserRole.FARMER && !farmer) {
      return validationError("The farmer record linked to this account could not be found.", 409);
    }

    if (
      typeof profileName !== "string" ||
      profileName.trim().length < 2 ||
      profileName.trim().length > 160 ||
      typeof profileBio !== "string" ||
      profileBio.length > 1000 ||
      typeof notifications !== "boolean" ||
      (timeFormat !== UserTimeFormat.H12 && timeFormat !== UserTimeFormat.H24)
    ) {
      return validationError("Enter a valid name, bio, notification preference and time format.");
    }
    if (
      user.role === UserRole.FARMER &&
      (typeof phone !== "string" ||
        phone.length > 32 ||
        typeof location !== "string" ||
        location.length > 240 ||
        !isFarmingMethod(farmingValue))
    ) {
      return validationError("Enter a valid phone number, location and farming method.");
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          name: profileName.trim(),
          profileBio: profileBio.trim() || null,
          emailNotifications: notifications,
          timeFormat,
        },
      });
      if (farmer && user.role === UserRole.FARMER) {
        await tx.farmer.update({
          where: { id: farmer.id },
          data: {
            name: profileName.trim(),
            phone: profilePhone || null,
            location: profileLocation || null,
            farmingMethod: farmingMethod(farmingValue),
          },
        });
      }
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
