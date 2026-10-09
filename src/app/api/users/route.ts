import { UserRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { hashPassword, requireSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const roles = new Set(Object.values(UserRole));
function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && roles.has(value as UserRole);
}

export async function POST(request: NextRequest) {
  try {
    const actor = await requireSessionUser();
    if (actor.role !== UserRole.ADMIN) {
      return validationError("Only an administrator can create team accounts.", 403);
    }
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return validationError("A valid JSON object is required.");
    const { name, email, password, role } = body as Record<string, unknown>;
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 160) {
      return validationError("Name must be between 2 and 160 characters.");
    }
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
      return validationError("Enter a valid email address.");
    }
    if (typeof password !== "string" || password.length < 12 || password.length > 128) {
      return validationError("Password must be between 12 and 128 characters.");
    }
    if (!isUserRole(role)) {
      return validationError("Choose a valid CropCycle role.");
    }

    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await hashPassword(password);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          name: name.trim(),
          email: normalizedEmail,
          passwordHash,
          role,
        },
      });
      if (created.role === UserRole.FARMER) {
        const [counter] = await tx.$queryRaw<{ value: bigint }[]>`
          INSERT INTO "FarmerIdCounter" ("name", "value")
          VALUES ('farmer', 1)
          ON CONFLICT ("name")
          DO UPDATE SET "value" = "FarmerIdCounter"."value" + 1
          RETURNING "value"
        `;
        await tx.farmer.create({
          data: {
            farmerCode: `AGR-F-${counter.value.toString().padStart(6, "0")}`,
            userId: created.id,
            createdById: actor.id,
            name: created.name,
            email: created.email,
          },
        });
      }
      return created;
    });
    return NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
