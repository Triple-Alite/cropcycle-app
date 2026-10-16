ALTER TABLE "Device" ADD COLUMN "apiKeyHash" VARCHAR(64);

CREATE UNIQUE INDEX "Device_apiKeyHash_key" ON "Device"("apiKeyHash");
