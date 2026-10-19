ALTER TABLE "Device"
ADD COLUMN "externalNodeId" VARCHAR(100);

CREATE UNIQUE INDEX "Device_externalNodeId_key" ON "Device"("externalNodeId");
