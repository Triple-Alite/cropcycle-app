CREATE TYPE "UserLanguage" AS ENUM ('EN', 'YO', 'HA');

ALTER TABLE "User"
ADD COLUMN "language" "UserLanguage" NOT NULL DEFAULT 'EN';
