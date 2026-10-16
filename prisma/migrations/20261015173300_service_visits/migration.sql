CREATE TYPE "ServiceVisitStatus" AS ENUM (
    'REQUESTED',
    'SCHEDULED',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED'
);

CREATE TABLE "ServiceVisit" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "plotId" TEXT,
    "deviceId" TEXT,
    "requestedById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "serviceType" VARCHAR(80) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ServiceVisitStatus" NOT NULL DEFAULT 'REQUESTED',
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "operationsNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceVisit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ServiceVisit_farmId_status_scheduledAt_idx" ON "ServiceVisit"("farmId", "status", "scheduledAt");
CREATE INDEX "ServiceVisit_requestedById_createdAt_idx" ON "ServiceVisit"("requestedById", "createdAt");
CREATE INDEX "ServiceVisit_assignedToId_status_idx" ON "ServiceVisit"("assignedToId", "status");

ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_farmId_fkey"
    FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_plotId_fkey"
    FOREIGN KEY ("plotId") REFERENCES "Plot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_requestedById_fkey"
    FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ServiceVisit" ADD CONSTRAINT "ServiceVisit_assignedToId_fkey"
    FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
