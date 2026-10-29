import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { hashPassword, hashSessionToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const TOKEN_TTL_MS = 60 * 60 * 1000;

export async function POST(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || !("email" in body) || typeof body.email !== "string") {
      return validationError("Enter a valid email address.");
    }
    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
      return validationError("Enter a valid email address.");
    }

    const endpoint = process.env.PASSWORD_RESET_EMAIL_ENDPOINT;
    const apiKey = process.env.PASSWORD_RESET_EMAIL_API_KEY;
    const appUrl = process.env.AGROGAUGE_APP_URL || process.env.CROPCYCLE_APP_URL;
    if (Boolean(endpoint) !== Boolean(apiKey)) {
      return validationError("Password reset email endpoint and API key must be configured together.", 503);
    }
    if (process.env.NODE_ENV === "production" && (!endpoint || !apiKey || !appUrl)) {
      return validationError("Password reset email is not configured. Contact your administrator.", 503);
    }
    if (endpoint) {
      try {
        if (new URL(endpoint).protocol !== "https:") {
          return validationError("Password reset email endpoint must use HTTPS.", 503);
        }
      } catch {
        return validationError("Password reset email endpoint is invalid.", 503);
      }
    }
    if (process.env.NODE_ENV === "production") {
      try {
        if (new URL(endpoint!).protocol !== "https:" || new URL(appUrl!).protocol !== "https:") {
          return validationError("Password reset URLs must use HTTPS.", 503);
        }
      } catch {
        return validationError("Password reset URL configuration is invalid.", 503);
      }
    }

    const user = await prisma.user.findFirst({
      where: { email, disabledAt: null },
      select: { id: true, email: true },
    });
    let resetUrl: string | undefined;
    if (user) {
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
      await prisma.$transaction([
        prisma.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        }),
        prisma.passwordResetToken.create({
          data: {
            tokenHash: hashSessionToken(token),
            userId: user.id,
            expiresAt,
          },
        }),
      ]);
      const baseUrl = new URL(appUrl ?? request.nextUrl.origin);
      if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
        return validationError("Password reset URL configuration is invalid.", 503);
      }
      const url = new URL("/reset-password", baseUrl);
      url.searchParams.set("token", token);
      resetUrl = url.toString();
      if (endpoint && apiKey) {
        try {
          const delivery = await fetch(endpoint, {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(10_000),
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              to: user.email,
              template: "cropcycle-password-reset",
              data: { resetUrl, expiresInMinutes: TOKEN_TTL_MS / 60_000 },
            }),
          });
          if (!delivery.ok) {
            console.error("Password reset email delivery failed with status:", delivery.status);
          }
        } catch (error) {
          console.error("Password reset email delivery failed:", error);
        }
      }
    }

    if (!endpoint && process.env.NODE_ENV !== "production" && resetUrl) {
      return NextResponse.json({
        message: "Password reset link created for local development.",
        resetUrl,
      });
    }
    return NextResponse.json({
      message: "If an account exists for that email, password reset instructions are on their way.",
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return validationError("A valid JSON object is required.");
    const { token, password } = body as Record<string, unknown>;
    if (typeof token !== "string" || token.length < 32 || token.length > 128) {
      return validationError("This password reset link is invalid or expired.", 400);
    }
    if (typeof password !== "string" || password.length < 12 || password.length > 128) {
      return validationError("Password must be between 12 and 128 characters.");
    }
    const tokenHash = hashSessionToken(token);
    const resetToken = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { userId: true, usedAt: true, expiresAt: true },
    });
    if (!resetToken || resetToken.usedAt || resetToken.expiresAt <= new Date()) {
      return validationError("This password reset link is invalid or expired.", 400);
    }
    const passwordHash = await hashPassword(password);
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (claimed.count !== 1) throw new Error("This password reset link is invalid or expired.");
      await tx.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      });
      await tx.session.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    return NextResponse.json({ message: "Password updated. Please sign in with your new password." });
  } catch (error) {
    if (error instanceof Error && error.message === "This password reset link is invalid or expired.") {
      return validationError(error.message, 400);
    }
    return errorResponse(error);
  }
}
