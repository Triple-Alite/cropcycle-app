import { ServiceVisitStatus, UserRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { errorResponse, validationError } from "@/lib/api";
import { requireSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const statuses = new Set(Object.values(ServiceVisitStatus));

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ serviceVisitId: string }> },
) {
  try {
    const user = await requireSessionUser();
    if (user.role !== UserRole.ADMIN) return validationError("Only AgroGauge service operations can update visits.", 403);
    const { serviceVisitId } = await params;
    const body: unknown = await request.json();
    if (!body || typeof body !== "object") return validationError("A valid JSON object is required.");
    const input = body as Record<string, unknown>;
    const current = await prisma.serviceVisit.findUnique({
      where: { id: serviceVisitId },
      select: { id: true, farmId: true, scheduledAt: true, completedAt: true },
    });
    if (!current) return validationError("Service visit not found.", 404);

    const data: {
      status?: ServiceVisitStatus;
      scheduledAt?: Date | null;
      assignedToId?: string | null;
      operationsNotes?: string | null;
      deviceId?: string | null;
      completedAt?: Date | null;
    } = {};
    if (input.status !== undefined) {
      if (typeof input.status !== "string" || !statuses.has(input.status as ServiceVisitStatus)) {
        return validationError("Choose a valid service visit status.");
      }
      data.status = input.status as ServiceVisitStatus;
      data.completedAt = input.status === ServiceVisitStatus.COMPLETED ? current.completedAt ?? new Date() : null;
    }
    if (input.scheduledAt !== undefined) {
      if (input.scheduledAt === null || input.scheduledAt === "") {
        data.scheduledAt = null;
      } else if (typeof input.scheduledAt !== "string" || !Number.isFinite(new Date(input.scheduledAt).getTime())) {
        return validationError("Enter a valid visit date and time.");
      } else {
        data.scheduledAt = new Date(input.scheduledAt);
      }
    }
    if (input.assignedToId !== undefined) {
      if (input.assignedToId === null || input.assignedToId === "") {
        data.assignedToId = null;
      } else if (typeof input.assignedToId !== "string") {
        return validationError("Choose a valid service assignee.");
      } else {
        const assignee = await prisma.user.findFirst({
          where: {
            id: input.assignedToId,
            role: { in: [UserRole.ADMIN, UserRole.FIELD_AGENT] },
            disabledAt: null,
          },
          select: { id: true },
        });
        if (!assignee) return validationError("Service assignee not found or not active.", 404);
        data.assignedToId = assignee.id;
      }
    }
    if (input.operationsNotes !== undefined) {
      if (typeof input.operationsNotes !== "string" || input.operationsNotes.length > 5000) {
        return validationError("Operations notes must be 5000 characters or fewer.");
      }
      data.operationsNotes = input.operationsNotes.trim() || null;
    }
    if (input.deviceCode !== undefined) {
      if (input.deviceCode === null || input.deviceCode === "") {
        data.deviceId = null;
      } else if (typeof input.deviceCode !== "string") {
        return validationError("Choose a valid device.");
      } else {
        const device = await prisma.device.findFirst({
          where: { deviceCode: input.deviceCode, OR: [{ farmId: current.farmId }, { assignments: { some: { farmId: current.farmId, releasedAt: null } } }] },
          select: { id: true },
        });
        if (!device) return validationError("Device is not assigned to this farm.", 400);
        data.deviceId = device.id;
      }
    }
    const scheduledAt = data.scheduledAt === undefined ? current.scheduledAt : data.scheduledAt;
    if (data.status === ServiceVisitStatus.SCHEDULED && !scheduledAt) {
      return validationError("Set a date and time before scheduling the service visit.");
    }

    const visit = await prisma.serviceVisit.update({
      where: { id: serviceVisitId },
      data,
      include: {
        farm: { select: { farmCode: true, name: true } },
        plot: { select: { plotCode: true, name: true } },
        device: { select: { deviceCode: true } },
        requestedBy: { select: { name: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json({
      visit: {
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
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
