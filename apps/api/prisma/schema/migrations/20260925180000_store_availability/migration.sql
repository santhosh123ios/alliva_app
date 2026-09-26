CREATE TYPE "StoreAvailability" AS ENUM ('OPEN', 'CLOSED', 'BUSY');

ALTER TABLE "Merchant" ADD COLUMN "availability" "StoreAvailability" NOT NULL DEFAULT 'OPEN';
