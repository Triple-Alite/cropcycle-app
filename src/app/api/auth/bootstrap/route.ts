import { timingSafeEqual } from "node:crypto";
import { UserRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { createSessionToken, hashPassword, hashSessionToken, SESSION_COOKIE, SESSION_TTL_MS } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const bootstrapSecret = process.env.CROPCYCLE_ADMIN_BOOTSTRAP_TOKEN;
    const suppliedSecret = request.headers.get("x-bootstrap-token");
    if (!bootstrapSecret || bootstrapSecret.length < 32 || !suppliedSecret) {
      return validationError("Administrator bootstrap is not configured.", 404);
    }
    const expected = Buffer.from(bootstrapSecret);
    const supplied = Buffer.from(suppliedSecret);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      return validationError("Administrator bootstrap is not authorized.", 403);
    }
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return validationError("A valid JSON object is required.");
    const { name, email, password } = body as Record<string, unknown>;
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 160) {
      return validationError("Name must be between 2 and 160 characters.");
    }
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
      return validationError("Enter a valid email address.");
    }
    if (typeof password !== "string" || password.length < 12 || password.length > 128) {
      return validationError("Password must be between 12 and 128 characters.");
    }

    const passwordHash = await hashPassword(password);
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const user = await prisma.$transaction(async (tx) => {
      if (await tx.user.count({ where: { role: UserRole.ADMIN } })) {
        throw new Error("Administrator bootstrap has already been completed.");
      }
      const created = await tx.user.create({
        data: {
          name: name.trim(),
          email: email.trim().toLowerCase(),
          passwordHash,
          role: UserRole.ADMIN,
        },
      });
      await tx.session.create({
        data: { tokenHash: hashSessionToken(token), userId: created.id, expiresAt },
      });
      return created;
    }, { isolationLevel: "Serializable" });

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
    if (error instanceof Error && error.message === "Administrator bootstrap has already been completed.") {
      return validationError(error.message, 409);
    }
    if (error instanceof Error && "code" in error && error.code === "P2034") {
      return validationError("Administrator bootstrap has already been completed.", 409);
    }
    return errorResponse(error);
  }
}
