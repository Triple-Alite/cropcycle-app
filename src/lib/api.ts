import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

export function errorResponse(error: unknown) {
  if (error instanceof Error && error.message === "Authentication required.") {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return NextResponse.json({ error: "A record with those details already exists." }, { status: 409 });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
    return NextResponse.json({ error: "A concurrent update conflicted. Please retry the request." }, { status: 409 });
  }
  if (error instanceof SyntaxError) {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  console.error("CropCycle API request failed:", error);
  return NextResponse.json({ error: "The request could not be completed." }, { status: 500 });
}

export function validationError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
