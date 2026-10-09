import { NextRequest, NextResponse } from "next/server";
import { createSessionToken, hashSessionToken, SESSION_COOKIE, SESSION_TTL_MS, verifyPassword } from "@/lib/auth";
import { errorResponse, validationError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return validationError("A valid JSON object is required.");
    const { email, password } = body as Record<string, unknown>;
    if (
      typeof email !== "string" ||
      email.length > 320 ||
      typeof password !== "string" ||
      password.length < 1 ||
      password.length > 128
    ) {
      return validationError("Enter an email and a password of at most 128 characters.");
    }

    const user = await prisma.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    const passwordMatches = await verifyPassword(password, user?.passwordHash ?? null);
    if (!user || !passwordMatches || user.disabledAt) {
      return validationError("Email or password is incorrect.", 401);
    }

    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await prisma.session.create({
      data: { tokenHash: hashSessionToken(token), userId: user.id, expiresAt },
    });
    const response = NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
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
