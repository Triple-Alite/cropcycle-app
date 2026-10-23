import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/api";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  farmerWhere,
  farmWhere,
  farmingMethodLabel,
  publicRole,
  recommendationWhere,
  seasonInclude,
  plotInclude,
  farmInclude,
} from "@/lib/workspace";

export async function GET() {
  try {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    const [farmers, farms, plots, seasons, readings, devices, recommendations, outcomes, serviceVisits, profile] = await Promise.all([
      prisma.farmer.findMany({
        where: farmerWhere(user),
        select: {
          farmerCode: true,
          name: true,
          phone: true,
          location: true,
          farmingMethod: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.farm.findMany({
        where: farmWhere(user),
        include: farmInclude,
        orderBy: { createdAt: "desc" },
      }),
      prisma.plot.findMany({
        where: { farm: farmWhere(user) },
        include: plotInclude,
        orderBy: { createdAt: "desc" },
      }),
      prisma.season.findMany({
        where: { farm: farmWhere(user) },
        include: {
          ...seasonInclude,
          soilReadings: {
            where: { syncStatus: "SYNCED" },
            orderBy: { recordedAt: "desc" },
            take: 1,
            select: { recordedAt: true },
          },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.soilReading.findMany({
        where: { farm: farmWhere(user) },
        include: {
          plot: { select: { name: true } },
          farm: { select: { farmCode: true, name: true } },
        },
        orderBy: { recordedAt: "desc" },
        take: 100,
      }),
      prisma.device.findMany({
        where: {
          status: "ACTIVE",
          externalNodeId: { not: null },
          OR: [
            { farm: { is: farmWhere(user) } },
            { assignments: { some: { releasedAt: null, farm: farmWhere(user) } } },
          ],
        },
        select: {
          id: true,
          deviceCode: true,
          externalNodeId: true,
          farmId: true,
          farm: { select: { farmCode: true, name: true } },
          assignments: {
            where: { releasedAt: null },
            orderBy: { assignedAt: "desc" },
            take: 1,
            select: { farm: { select: { farmCode: true, name: true } } },
          },
        },
        orderBy: { deviceCode: "asc" },
      }),
      prisma.recommendation.findMany({
        where: recommendationWhere(user),
        include: {
          farm: { select: { farmCode: true, name: true } },
          plot: { select: { plotCode: true, name: true } },
          season: { select: { name: true } },
          knowledgeRules: {
            include: {
              knowledgeRule: {
                select: { id: true, title: true, sourceCitation: true, version: true },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      prisma.outcome.findMany({
        where: { farm: { is: farmWhere(user) } },
        include: {
          farm: { select: { name: true } },
          plot: { select: { name: true } },
          season: { select: { name: true } },
          feedback: { select: { rating: true, comment: true } },
        },
        orderBy: { recordedAt: "desc" },
        take: 50,
      }),
      prisma.serviceVisit.findMany({
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
      }),
      prisma.user.findUnique({
        where: { id: user.id },
        select: {
          email: true,
          name: true,
          profileBio: true,
          avatarUrl: true,
          emailNotifications: true,
          timeFormat: true,
          language: true,
          farmerProfile: {
            select: { phone: true, location: true, farmingMethod: true },
          },
        },
      }),
    ]);
    if (!profile) return NextResponse.json({ error: "The signed-in profile could not be found." }, { status: 404 });

    return NextResponse.json({
      farmer: user.name,
      role: publicRole(user.role),
      profile: {
        email: profile.email,
        name: profile.name,
        bio: profile.profileBio ?? "",
        avatarUrl: profile.avatarUrl,
        emailNotifications: profile.emailNotifications,
        timeFormat: profile.timeFormat,
        language: profile.language,
        phone: profile.farmerProfile?.phone ?? "",
        location: profile.farmerProfile?.location ?? "",
        farming: profile.farmerProfile ? farmingMethodLabel(profile.farmerProfile.farmingMethod) : "Not recorded",
      },
      farmers: farmers.map((farmer) => ({
        id: farmer.farmerCode,
        name: farmer.name,
        phone: farmer.phone ?? "",
        location: farmer.location ?? "",
        farming: farmingMethodLabel(farmer.farmingMethod),
      })),
      farms: farms.map((farm) => ({
        id: farm.farmCode,
        ownerId: farm.owner.farmerCode,
        name: farm.name,
        location: farm.location ?? "",
        area: Number(farm.areaHectares ?? 0),
        plots: farm._count.plots,
      })),
      plots: plots.map((plot) => ({
        id: plot.plotCode,
        farmId: plot.farm.farmCode,
        farm: plot.farm.name,
        name: plot.name,
        area: Number(plot.areaHectares ?? 0),
        location: plot.location ?? "",
        latitude: plot.latitude === null ? undefined : Number(plot.latitude),
        longitude: plot.longitude === null ? undefined : Number(plot.longitude),
      })),
      seasons: seasons.map((season) => {
        const currentCrops = [...new Set(season.crops
          .filter((crop) => crop.recordType === "ACTUAL" || crop.recordType === "INTENDED")
          .map((crop) => crop.name))];
        const status = season.status === "COMPLETED" ? "Completed" : season.status === "PLANNING" ? "Planning" : season.status === "CANCELLED" ? "Cancelled" : "In progress";
        return {
          id: season.id,
          farmId: season.farm.farmCode,
          plotId: season.plot.plotCode,
          farm: season.farm.name,
          plot: season.plot.name,
          name: season.name,
          crop: currentCrops.join(" + ") || "Not recorded",
          hasAssessmentCrops: Boolean(
            currentCrops.length ||
            season.requirement?.intendedCrops.length ||
            season.requirement?.availableCrops.length ||
            season.requirement?.marketableCrops.length,
          ),
          latestReadingAt: season.soilReadings[0]?.recordedAt.toISOString() ?? null,
          available: season.requirement?.availableCrops.join(", ") ?? "",
          market: season.requirement?.marketableCrops.join(", ") ?? "",
          previousCrops: season.crops.filter((crop) => crop.recordType === "PREVIOUS").map((crop) => crop.name),
          method: farmingMethodLabel(season.farmingMethod),
          status,
        };
      }),
      readings: readings.map((reading) => ({
        id: reading.id,
        farmerId: reading.farmerId,
        farmId: reading.farm.farmCode,
        plotId: reading.plotId,
        seasonId: reading.seasonId,
        deviceId: reading.deviceId ?? undefined,
        timestamp: reading.recordedAt.toISOString(),
        plot: reading.plot.name,
        date: reading.recordedAt.toLocaleString(),
        nitrogen: reading.nitrogen === null ? null : Number(reading.nitrogen),
        phosphorus: reading.phosphorus === null ? null : Number(reading.phosphorus),
        potassium: reading.potassium === null ? null : Number(reading.potassium),
        soilTemperature: reading.soilTemperature === null ? null : Number(reading.soilTemperature),
        humidity: reading.humidity === null ? null : Number(reading.humidity),
        sync: reading.syncStatus === "SYNCED" ? "Synced" : "Pending sync",
        farm: reading.farm.name,
      })),
      devices: devices.flatMap((device) => {
        const assignedFarm = device.assignments[0]?.farm ?? device.farm;
        if (!assignedFarm || !device.externalNodeId) return [];
        return [{
          id: device.id,
          deviceCode: device.deviceCode,
          externalNodeId: device.externalNodeId,
          farmId: assignedFarm.farmCode,
          farm: assignedFarm.name,
        }];
      }),
      recommendations: recommendations.map((recommendation) => ({
        id: recommendation.id,
        version: recommendation.version,
        status: recommendation.status,
        provider: recommendation.provider,
        reviewedAt: recommendation.reviewedAt?.toISOString() ?? null,
        createdAt: recommendation.createdAt.toISOString(),
        farm: recommendation.farm.name,
        farmId: recommendation.farm.farmCode,
        plot: recommendation.plot.name,
        plotId: recommendation.plot.plotCode,
        season: recommendation.season.name,
        seasonId: recommendation.seasonId,
        result: recommendation.result,
        inputSnapshot: recommendation.inputSnapshot,
        knowledge: recommendation.knowledgeRules.map(({ knowledgeRule }) => ({
          id: knowledgeRule.id,
          title: knowledgeRule.title,
          source: knowledgeRule.sourceCitation,
          version: knowledgeRule.version,
        })),
      })),
      outcomes: outcomes.map((outcome) => ({
        id: outcome.id,
        seasonId: outcome.seasonId,
        recommendationId: outcome.recommendationId,
        farm: outcome.farm.name,
        plot: outcome.plot.name,
        season: outcome.season.name,
        actualCrops: outcome.actualCrops,
        yieldQuantity: outcome.yieldQuantity === null ? null : Number(outcome.yieldQuantity),
        yieldUnit: outcome.yieldUnit,
        notes: outcome.notes,
        recordedAt: outcome.recordedAt.toISOString(),
        feedback: outcome.feedback,
      })),
      serviceVisits: serviceVisits.map((visit) => ({
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
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
