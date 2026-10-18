import { del, put } from "@vercel/blob";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { requireSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
const imageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function isImageContent(type: string, bytes: Uint8Array) {
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10";
  if (type === "image/webp") {
    return String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  }
  return false;
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser();
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    if (!token) {
      return validationError("Profile photo storage is not configured. Ask an administrator to connect Vercel Blob.", 503);
    }

    const form = await request.formData();
    const photo = form.get("photo");
    if (!(photo instanceof File)) return validationError("Choose a profile photo to upload.");
    if (photo.size < 1 || photo.size > MAX_PHOTO_BYTES) {
      return validationError("Profile photos must be no larger than 4 MB.");
    }
    const extension = imageTypes.get(photo.type);
    if (!extension) return validationError("Choose a JPEG, PNG or WebP image.");

    const bytes = new Uint8Array(await photo.arrayBuffer());
    if (!isImageContent(photo.type, bytes)) {
      return validationError("The uploaded file does not match its image type.");
    }

    const result = await put(`profile-photos/${user.id}.${extension}`, Buffer.from(bytes), {
      access: "public",
      addRandomSuffix: true,
      contentType: photo.type,
      token,
    });
    const previous = await prisma.user.findUnique({
      where: { id: user.id },
      select: { avatarUrl: true },
    });
    try {
      await prisma.user.update({
        where: { id: user.id },
        data: { avatarUrl: result.url },
      });
    } catch (error) {
      try {
        await del(result.url, { token });
      } catch (cleanupError) {
        console.error("Could not clean up an unlinked profile photo:", cleanupError);
      }
      throw error;
    }

    if (previous?.avatarUrl) {
      try {
        await del(previous.avatarUrl, { token });
      } catch (error) {
        console.error("Could not remove the previous profile photo:", error);
        return NextResponse.json({
          ok: true,
          warning: "Your new photo was saved, but the previous photo could not be removed.",
        });
      }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE() {
  try {
    const user = await requireSessionUser();
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    const existing = await prisma.user.findUnique({
      where: { id: user.id },
      select: { avatarUrl: true },
    });
    if (!existing) return validationError("The signed-in profile could not be found.", 404);
    await prisma.user.update({ where: { id: user.id }, data: { avatarUrl: null } });
    if (existing.avatarUrl) {
      if (!token) {
        return NextResponse.json({
          ok: true,
          warning: "The photo was removed from your profile, but storage is not configured to remove the uploaded file.",
        });
      }
      try {
        await del(existing.avatarUrl, { token });
      } catch (error) {
        console.error("Could not remove the profile photo from storage:", error);
        return NextResponse.json({
          ok: true,
          warning: "The photo was removed from your profile, but its stored file could not be deleted.",
        });
      }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
