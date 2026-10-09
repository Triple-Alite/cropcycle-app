-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'FIELD_AGENT', 'CROP_SCIENTIST', 'FARM_MANAGER', 'FARMER');

-- CreateEnum
CREATE TYPE "FarmMemberRole" AS ENUM ('OWNER', 'FARM_MANAGER', 'FIELD_WORKER', 'AGRADAR_AGENT');

-- CreateEnum
CREATE TYPE "FarmingMethod" AS ENUM ('MONO_CROPPING', 'MIXED_FARMING', 'NOT_RECORDED');

-- CreateEnum
CREATE TYPE "FarmStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'FALLOW', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SeasonStatus" AS ENUM ('PLANNING', 'ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CropRecordType" AS ENUM ('PREVIOUS', 'INTENDED', 'AVAILABLE', 'MARKETABLE', 'ACTUAL');

-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED', 'CONFLICT');

-- CreateEnum
CREATE TYPE "DeviceStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "DeviceOwnership" AS ENUM ('CROPCYCLE', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "KnowledgeStatus" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'SHARED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "passwordHash" VARCHAR(255),
    "role" "UserRole" NOT NULL DEFAULT 'FARMER',
    "emailVerifiedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Farmer" (
    "id" TEXT NOT NULL,
    "farmerCode" VARCHAR(24) NOT NULL,
    "userId" TEXT,
    "createdById" TEXT NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "phone" VARCHAR(32),
    "email" VARCHAR(320),
    "location" VARCHAR(240),
    "farmingMethod" "FarmingMethod" NOT NULL DEFAULT 'NOT_RECORDED',
    "farmingDetails" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Farmer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FarmerIdCounter" (
    "name" VARCHAR(32) NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "FarmerIdCounter_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "Farm" (
    "id" TEXT NOT NULL,
    "farmCode" VARCHAR(32) NOT NULL,
    "ownerFarmerId" TEXT NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "location" VARCHAR(240),
    "areaHectares" DECIMAL(12,3),
    "status" "FarmStatus" NOT NULL DEFAULT 'ACTIVE',
    "farmingMethod" "FarmingMethod" NOT NULL DEFAULT 'NOT_RECORDED',
    "boundary" JSONB,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Farm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FarmMembership" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "FarmMemberRole" NOT NULL,
    "canManageFarm" BOOLEAN NOT NULL DEFAULT false,
    "canManagePlots" BOOLEAN NOT NULL DEFAULT false,
    "canManageSeasons" BOOLEAN NOT NULL DEFAULT false,
    "canRecordSoil" BOOLEAN NOT NULL DEFAULT false,
    "canViewRecommendations" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FarmMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Plot" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "plotCode" VARCHAR(32) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "areaHectares" DECIMAL(12,3),
    "location" VARCHAR(240),
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "boundary" JSONB,
    "farmingMethod" "FarmingMethod" NOT NULL DEFAULT 'NOT_RECORDED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "plotId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "farmingMethod" "FarmingMethod" NOT NULL DEFAULT 'NOT_RECORDED',
    "status" "SeasonStatus" NOT NULL DEFAULT 'PLANNING',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonCrop" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "recordType" "CropRecordType" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SeasonCrop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonRequirement" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "intendedCrops" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "availableCrops" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "marketableCrops" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredMethod" "FarmingMethod",
    "otherRequirements" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeasonRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "deviceCode" VARCHAR(100) NOT NULL,
    "type" VARCHAR(80) NOT NULL,
    "status" "DeviceStatus" NOT NULL DEFAULT 'ACTIVE',
    "ownership" "DeviceOwnership" NOT NULL DEFAULT 'CROPCYCLE',
    "firmware" VARCHAR(80),
    "registeredById" TEXT,
    "farmId" TEXT,
    "plotId" TEXT,
    "lastConnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceAssignment" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "plotId" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "DeviceAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoilReading" (
    "id" TEXT NOT NULL,
    "idempotencyKey" VARCHAR(100) NOT NULL,
    "farmerId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "plotId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "deviceId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "moisture" DECIMAL(8,3),
    "pH" DECIMAL(5,3),
    "nitrogen" DECIMAL(10,3),
    "phosphorus" DECIMAL(10,3),
    "potassium" DECIMAL(10,3),
    "soilTemperature" DECIMAL(7,3),
    "humidity" DECIMAL(7,3),
    "sensorValues" JSONB,
    "syncStatus" "SyncStatus" NOT NULL DEFAULT 'SYNCED',
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SoilReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeRule" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" JSONB NOT NULL,
    "sourceCitation" TEXT NOT NULL,
    "status" "KnowledgeStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "plotId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "result" JSONB NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "provider" VARCHAR(100),
    "modelVersion" VARCHAR(100),
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationKnowledgeRule" (
    "recommendationId" TEXT NOT NULL,
    "knowledgeRuleId" TEXT NOT NULL,

    CONSTRAINT "RecommendationKnowledgeRule_pkey" PRIMARY KEY ("recommendationId","knowledgeRuleId")
);

-- CreateTable
CREATE TABLE "Outcome" (
    "id" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "farmId" TEXT NOT NULL,
    "plotId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "recommendationId" TEXT,
    "actualCrops" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "yieldQuantity" DECIMAL(12,3),
    "yieldUnit" VARCHAR(40),
    "notes" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Outcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "farmerId" TEXT NOT NULL,
    "recommendationId" TEXT,
    "outcomeId" TEXT,
    "recordedById" TEXT,
    "rating" INTEGER,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_disabledAt_idx" ON "User"("role", "disabledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_expiresAt_idx" ON "PasswordResetToken"("userId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Farmer_farmerCode_key" ON "Farmer"("farmerCode");

-- CreateIndex
CREATE UNIQUE INDEX "Farmer_userId_key" ON "Farmer"("userId");

-- CreateIndex
CREATE INDEX "Farmer_name_idx" ON "Farmer"("name");

-- CreateIndex
CREATE INDEX "Farmer_phone_idx" ON "Farmer"("phone");

-- CreateIndex
CREATE INDEX "Farmer_location_idx" ON "Farmer"("location");

-- CreateIndex
CREATE UNIQUE INDEX "Farm_farmCode_key" ON "Farm"("farmCode");

-- CreateIndex
CREATE INDEX "Farm_ownerFarmerId_status_idx" ON "Farm"("ownerFarmerId", "status");

-- CreateIndex
CREATE INDEX "Farm_location_idx" ON "Farm"("location");

-- CreateIndex
CREATE INDEX "FarmMembership_userId_role_idx" ON "FarmMembership"("userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "FarmMembership_farmId_userId_key" ON "FarmMembership"("farmId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Plot_plotCode_key" ON "Plot"("plotCode");

-- CreateIndex
CREATE INDEX "Plot_farmId_idx" ON "Plot"("farmId");

-- CreateIndex
CREATE UNIQUE INDEX "Plot_farmId_id_key" ON "Plot"("farmId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Plot_farmId_name_key" ON "Plot"("farmId", "name");

-- CreateIndex
CREATE INDEX "Season_farmId_status_idx" ON "Season"("farmId", "status");

-- CreateIndex
CREATE INDEX "Season_plotId_startsAt_idx" ON "Season"("plotId", "startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Season_farmId_plotId_name_key" ON "Season"("farmId", "plotId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Season_farmId_plotId_id_key" ON "Season"("farmId", "plotId", "id");

-- CreateIndex
CREATE INDEX "SeasonCrop_name_idx" ON "SeasonCrop"("name");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonCrop_seasonId_name_recordType_key" ON "SeasonCrop"("seasonId", "name", "recordType");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonRequirement_seasonId_key" ON "SeasonRequirement"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_deviceCode_key" ON "Device"("deviceCode");

-- CreateIndex
CREATE INDEX "Device_farmId_plotId_status_idx" ON "Device"("farmId", "plotId", "status");

-- CreateIndex
CREATE INDEX "DeviceAssignment_deviceId_releasedAt_idx" ON "DeviceAssignment"("deviceId", "releasedAt");

-- CreateIndex
CREATE INDEX "DeviceAssignment_farmId_plotId_releasedAt_idx" ON "DeviceAssignment"("farmId", "plotId", "releasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SoilReading_idempotencyKey_key" ON "SoilReading"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SoilReading_farmerId_recordedAt_idx" ON "SoilReading"("farmerId", "recordedAt");

-- CreateIndex
CREATE INDEX "SoilReading_farmId_plotId_recordedAt_idx" ON "SoilReading"("farmId", "plotId", "recordedAt");

-- CreateIndex
CREATE INDEX "SoilReading_seasonId_recordedAt_idx" ON "SoilReading"("seasonId", "recordedAt");

-- CreateIndex
CREATE INDEX "SoilReading_syncStatus_createdAt_idx" ON "SoilReading"("syncStatus", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeRule_status_effectiveFrom_effectiveTo_idx" ON "KnowledgeRule"("status", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeRule_key_version_key" ON "KnowledgeRule"("key", "version");

-- CreateIndex
CREATE INDEX "Recommendation_farmerId_createdAt_idx" ON "Recommendation"("farmerId", "createdAt");

-- CreateIndex
CREATE INDEX "Recommendation_farmId_plotId_createdAt_idx" ON "Recommendation"("farmId", "plotId", "createdAt");

-- CreateIndex
CREATE INDEX "Recommendation_status_createdAt_idx" ON "Recommendation"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_seasonId_version_key" ON "Recommendation"("seasonId", "version");

-- CreateIndex
CREATE INDEX "Outcome_farmerId_recordedAt_idx" ON "Outcome"("farmerId", "recordedAt");

-- CreateIndex
CREATE INDEX "Outcome_seasonId_idx" ON "Outcome"("seasonId");

-- CreateIndex
CREATE INDEX "Feedback_farmerId_createdAt_idx" ON "Feedback"("farmerId", "createdAt");

-- CreateIndex
CREATE INDEX "Feedback_recommendationId_idx" ON "Feedback"("recommendationId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Farmer" ADD CONSTRAINT "Farmer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Farmer" ADD CONSTRAINT "Farmer_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Farm" ADD CONSTRAINT "Farm_ownerFarmerId_fkey" FOREIGN KEY ("ownerFarmerId") REFERENCES "Farmer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmMembership" ADD CONSTRAINT "FarmMembership_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FarmMembership" ADD CONSTRAINT "FarmMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Plot" ADD CONSTRAINT "Plot_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_farmId_plotId_fkey" FOREIGN KEY ("farmId", "plotId") REFERENCES "Plot"("farmId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonCrop" ADD CONSTRAINT "SeasonCrop_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonRequirement" ADD CONSTRAINT "SeasonRequirement_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_farmId_plotId_fkey" FOREIGN KEY ("farmId", "plotId") REFERENCES "Plot"("farmId", "id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAssignment" ADD CONSTRAINT "DeviceAssignment_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAssignment" ADD CONSTRAINT "DeviceAssignment_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeviceAssignment" ADD CONSTRAINT "DeviceAssignment_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "Plot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoilReading" ADD CONSTRAINT "SoilReading_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "Farmer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoilReading" ADD CONSTRAINT "SoilReading_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoilReading" ADD CONSTRAINT "SoilReading_farmId_plotId_fkey" FOREIGN KEY ("farmId", "plotId") REFERENCES "Plot"("farmId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoilReading" ADD CONSTRAINT "SoilReading_farmId_plotId_seasonId_fkey" FOREIGN KEY ("farmId", "plotId", "seasonId") REFERENCES "Season"("farmId", "plotId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoilReading" ADD CONSTRAINT "SoilReading_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRule" ADD CONSTRAINT "KnowledgeRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRule" ADD CONSTRAINT "KnowledgeRule_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "Farmer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_farmId_plotId_fkey" FOREIGN KEY ("farmId", "plotId") REFERENCES "Plot"("farmId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_farmId_plotId_seasonId_fkey" FOREIGN KEY ("farmId", "plotId", "seasonId") REFERENCES "Season"("farmId", "plotId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationKnowledgeRule" ADD CONSTRAINT "RecommendationKnowledgeRule_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationKnowledgeRule" ADD CONSTRAINT "RecommendationKnowledgeRule_knowledgeRuleId_fkey" FOREIGN KEY ("knowledgeRuleId") REFERENCES "KnowledgeRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outcome" ADD CONSTRAINT "Outcome_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "Farmer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outcome" ADD CONSTRAINT "Outcome_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outcome" ADD CONSTRAINT "Outcome_farmId_plotId_fkey" FOREIGN KEY ("farmId", "plotId") REFERENCES "Plot"("farmId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outcome" ADD CONSTRAINT "Outcome_farmId_plotId_seasonId_fkey" FOREIGN KEY ("farmId", "plotId", "seasonId") REFERENCES "Season"("farmId", "plotId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outcome" ADD CONSTRAINT "Outcome_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_farmerId_fkey" FOREIGN KEY ("farmerId") REFERENCES "Farmer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "Outcome"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
