import { FarmingMethod, UserRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { hashPassword, SESSION_COOKIE, SESSION_TTL_MS, createSessionToken, hashSessionToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { errorResponse, validationError } from "@/lib/api";

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return validationError("A valid JSON object is required.");
    const { name, email, password } = body as Record<string, unknown>;
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 160) {
      return validationError("Name must be between 2 and 160 characters.");
    }
    if (
      typeof email !== "string" ||
      email.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return validationError("Enter a valid email address.");
    }
    if (typeof password !== "string" || password.length < 12 || password.length > 128) {
      return validationError("Password must be between 12 and 128 characters.");
    }

    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await hashPassword(password);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { name: name.trim(), email: normalizedEmail, passwordHash, role: UserRole.FARMER },
      });
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
          createdById: created.id,
          name: created.name,
          email: created.email,
          farmingMethod: FarmingMethod.NOT_RECORDED,
        },
      });
      return created;
    });

    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await prisma.session.create({
      data: { tokenHash: hashSessionToken(token), userId: user.id, expiresAt },
    });

    const response = NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    }, { status: 201 });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      expires: expiresAt,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
