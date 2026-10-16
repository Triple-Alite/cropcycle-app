import { ServiceVisitStatus, UserRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { requireSessionUser } from "@/lib/auth";
import { farmWhere } from "@/lib/workspace";
import { prisma } from "@/lib/prisma";

const serviceTypes = new Set(["DEVICE_SUPPORT", "SOIL_TESTING", "MAINTENANCE", "FARM_VISIT", "OTHER"]);
const requestRoles: ReadonlySet<UserRole> = new Set([
  UserRole.ADMIN,
  UserRole.FIELD_AGENT,
  UserRole.FARM_MANAGER,
  UserRole.FARMER,
]);

function presentServiceVisit(visit: {
  id: string;
  serviceType: string;
  description: string;
  status: ServiceVisitStatus;
  scheduledAt: Date | null;
  completedAt: Date | null;
  operationsNotes: string | null;
  createdAt: Date;
  farm: { farmCode: string; name: string };
  plot: { plotCode: string; name: string } | null;
  device: { deviceCode: string } | null;
  requestedBy: { name: string };
  assignedTo: { id: string; name: string } | null;
}) {
  return {
    id: visit.id,
    serviceType: visit.serviceType,
    description: visit.description,
    status: visit.status,
    scheduledAt: visit.scheduledAt?.toISOString() ?? null,
    completedAt: visit.completedAt?.toISOString() ?? null,
    operationsNotes: visit.operationsNotes ?? "",
    createdAt: visit.createdAt.toISOString(),
    farmId: visit.farm.farmCode,
    farm: visit.farm.name,
    plotId: visit.plot?.plotCode ?? null,
    plot: visit.plot?.name ?? "",
    deviceCode: visit.device?.deviceCode ?? "",
    requestedBy: visit.requestedBy.name,
    assignedToId: visit.assignedTo?.id ?? "",
    assignedTo: visit.assignedTo?.name ?? "",
  };
}

export async function GET() {
  try {
    const user = await requireSessionUser();
    const visits = await prisma.serviceVisit.findMany({
      where: { farm: farmWhere(user) },
      include: {
        farm: { select: { farmCode: true, name: true } },
        plot: { select: { plotCode: true, name: true } },
        device: { select: { deviceCode: true } },
        requestedBy: { select: { name: true } },
        assignedTo: { select: { id: true, name: true } },
      },
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
      take: 200,
    });
    const staff = user.role === UserRole.ADMIN
      ? await prisma.user.findMany({
          where: { role: { in: [UserRole.ADMIN, UserRole.FIELD_AGENT] }, disabledAt: null },
          select: { id: true, name: true, role: true },
          orderBy: { name: "asc" },
        })
      : [];
    return NextResponse.json({
      visits: visits.map(presentServiceVisit),
      staff: staff.map(({ id, name, role }) => ({ id, name, role })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireSessionUser();
    if (!requestRoles.has(user.role)) {
      return validationError("Your role cannot request a service visit.", 403);
    }
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return validationError("A valid JSON object is required.");
    const input = body as Record<string, unknown>;
    if (typeof input.farmCode !== "string") return validationError("Choose a farm for this service request.");
    if (typeof input.serviceType !== "string" || !serviceTypes.has(input.serviceType)) {
      return validationError("Choose a valid service type.");
    }
    if (typeof input.description !== "string" || input.description.trim().length < 5 || input.description.trim().length > 5000) {
      return validationError("Describe the service needed in 5 to 5000 characters.");
    }

    const farm = await prisma.farm.findFirst({
      where: { farmCode: input.farmCode, ...farmWhere(user) },
      select: { id: true },
    });
    if (!farm) return validationError("Farm not found or not accessible.", 404);

    let plotId: string | null = null;
    if (input.plotCode !== undefined && input.plotCode !== null && input.plotCode !== "") {
      if (typeof input.plotCode !== "string") return validationError("Choose a valid field.");
      const plot = await prisma.plot.findFirst({
        where: { plotCode: input.plotCode, farmId: farm.id },
        select: { id: true },
      });
      if (!plot) return validationError("Field not found on the selected farm.", 404);
      plotId = plot.id;
    }

    const visit = await prisma.serviceVisit.create({
      data: {
        farmId: farm.id,
        plotId,
        requestedById: user.id,
        serviceType: input.serviceType,
        description: input.description.trim(),
      },
      include: {
        farm: { select: { farmCode: true, name: true } },
        plot: { select: { plotCode: true, name: true } },
        device: { select: { deviceCode: true } },
        requestedBy: { select: { name: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json({ visit: presentServiceVisit(visit) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
