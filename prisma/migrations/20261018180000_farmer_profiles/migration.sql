CREATE TYPE "UserTimeFormat" AS ENUM ('H12', 'H24');

ALTER TABLE "User"
ADD COLUMN "profileBio" VARCHAR(1000),
ADD COLUMN "avatarUrl" VARCHAR(2048),
ADD COLUMN "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "timeFormat" "UserTimeFormat" NOT NULL DEFAULT 'H12';
