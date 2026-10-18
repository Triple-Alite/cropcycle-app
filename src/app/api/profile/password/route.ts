import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { createSessionToken, hashPassword, hashSessionToken, requireSessionUser, SESSION_COOKIE, SESSION_TTL_MS, verifyPassword } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser();
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return validationError("A valid JSON object is required.");
    }
    const input = body as Record<string, unknown>;
    if (
      typeof input.currentPassword !== "string" ||
      typeof input.newPassword !== "string" ||
      input.newPassword.length < 12 ||
      input.newPassword.length > 128
    ) {
      return validationError("Enter your current password and a new password between 12 and 128 characters.");
    }
    if (input.currentPassword === input.newPassword) {
      return validationError("Choose a new password different from your current password.");
    }

    const account = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    if (!account || !await verifyPassword(input.currentPassword, account.passwordHash)) {
      return validationError("Your current password is incorrect.", 401);
    }

    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const passwordHash = await hashPassword(input.newPassword);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.session.create({
        data: { tokenHash: hashSessionToken(token), userId: user.id, expiresAt },
      });
    });

    const response = NextResponse.json({ ok: true });
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
