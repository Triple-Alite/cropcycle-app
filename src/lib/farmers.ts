import { FarmingMethod, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type RegisterFarmerInput = {
  name: string;
  createdById: string;
  phone?: string;
  email?: string;
  location?: string;
  farmingMethod?: FarmingMethod;
  farmingDetails?: string;
};

export async function registerFarmer(input: RegisterFarmerInput) {
  const name = input.name.trim();
  if (!name) throw new Error("Farmer name is required.");

  return prisma.$transaction(async (tx) => {
    const counters = await tx.$queryRaw<{ value: bigint }[]>(Prisma.sql`
      INSERT INTO "FarmerIdCounter" ("name", "value")
      VALUES ('farmer', 1)
      ON CONFLICT ("name")
      DO UPDATE SET "value" = "FarmerIdCounter"."value" + 1
      RETURNING "value"
    `);
    const farmerCode = `AGR-F-${counters[0].value.toString().padStart(6, "0")}`;

    return tx.farmer.create({
      data: {
        farmerCode,
        name,
        createdById: input.createdById,
        phone: input.phone?.trim() || null,
        email: input.email?.trim().toLowerCase() || null,
        location: input.location?.trim() || null,
        farmingMethod: input.farmingMethod ?? FarmingMethod.NOT_RECORDED,
        farmingDetails: input.farmingDetails?.trim() || null,
      },
    });
  });
}