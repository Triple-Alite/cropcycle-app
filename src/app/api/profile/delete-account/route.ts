import { UserRole } from "@prisma/client";
import { del } from "@vercel/blob";
import { NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { requireSessionUser, SESSION_COOKIE } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE() {
  try {
    const user = await requireSessionUser();
    if (user.role !== UserRole.FARMER) {
      return validationError("Only farmer accounts can be deactivated from this profile page.", 403);
    }

    const profile = await prisma.user.findUnique({
      where: { id: user.id },
      select: { avatarUrl: true },
    });
    if (!profile) return validationError("The signed-in profile could not be found.", 404);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { disabledAt: new Date(), avatarUrl: null, profileBio: null },
      });
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    let warning: string | undefined;
    if (profile.avatarUrl) {
      const token = process.env.BLOB_READ_WRITE_TOKEN;
      if (!token) {
        warning = "Your account was deactivated, but its old profile photo could not be removed from storage.";
      } else {
        try {
          await del(profile.avatarUrl, { token });
        } catch (error) {
          console.error("Could not delete the deactivated farmer's profile photo:", error);
          warning = "Your account was deactivated, but its old profile photo could not be removed from storage.";
        }
      }
    }
    const response = NextResponse.json({ ok: true, warning });
    response.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return response;
  } catch (error) {
    return errorResponse(error);
  }
}
