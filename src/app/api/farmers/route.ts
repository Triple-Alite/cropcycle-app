import { UserRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { requireSessionUser } from "@/lib/auth";
import { registerFarmer } from "@/lib/farmers";
import { farmerWhere, farmingMethod, farmingMethodLabel, isFarmingMethod } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.FIELD_AGENT) {
      return validationError("Your role cannot register farmers.", 403);
    }
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return validationError("A valid JSON object is required.");
    const input = body as Record<string, unknown>;
    if (typeof input.name !== "string" || input.name.trim().length < 2) {
      return validationError("Farmer name must be at least 2 characters.");
    }
    if (typeof input.name === "string" && input.name.trim().length > 160) {
      return validationError("Farmer name cannot exceed 160 characters.");
    }
    if (input.phone !== undefined && (typeof input.phone !== "string" || input.phone.length > 32)) {
      return validationError("Phone number must be 32 characters or fewer.");
    }
    if (input.location !== undefined && (typeof input.location !== "string" || input.location.length > 240)) {
      return validationError("Location must be 240 characters or fewer.");
    }
    if (!isFarmingMethod(input.farming)) return validationError("Choose a valid farming method.");
    const farmer = await registerFarmer({
      name: input.name,
      createdById: user.id,
      phone: typeof input.phone === "string" ? input.phone : undefined,
      location: typeof input.location === "string" ? input.location : undefined,
      farmingMethod: farmingMethod(input.farming),
    });
    return NextResponse.json({
      farmer: {
        id: farmer.farmerCode,
        name: farmer.name,
        phone: farmer.phone ?? "",
        location: farmer.location ?? "",
        farming: farmingMethodLabel(farmer.farmingMethod),
      },
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.FIELD_AGENT && user.role !== UserRole.FARMER) {
      return validationError("Your role cannot edit farmer records.", 403);
    }
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return validationError("A valid JSON object is required.");
    const input = body as Record<string, unknown>;
    if (typeof input.id !== "string") return validationError("Farmer ID is required.");
    const existing = await prisma.farmer.findFirst({
      where: { farmerCode: input.id, ...farmerWhere(user) },
    });
    if (!existing) return validationError("Farmer not found.", 404);
    if (user.role === UserRole.FARMER && existing.userId !== user.id) {
      return validationError("You can only edit your own farmer record.", 403);
    }
    if (
      typeof input.name !== "string" ||
      input.name.trim().length < 2 ||
      input.name.trim().length > 160 ||
      typeof input.phone !== "string" ||
      input.phone.length > 32 ||
      typeof input.location !== "string" ||
      input.location.length > 240 ||
      !isFarmingMethod(input.farming)
    ) {
      return validationError("Provide a valid name, phone number and location.");
    }
    const farmer = await prisma.farmer.update({
      where: { id: existing.id },
      data: {
        name: input.name.trim(),
        phone: input.phone.trim() || null,
        location: input.location.trim() || null,
        farmingMethod: farmingMethod(input.farming),
      },
    });
    return NextResponse.json({
      farmer: {
        id: farmer.farmerCode,
        name: farmer.name,
        phone: farmer.phone ?? "",
        location: farmer.location ?? "",
        farming: farmingMethodLabel(farmer.farmingMethod),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
