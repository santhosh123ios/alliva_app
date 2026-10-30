-- CreateEnum
CREATE TYPE "CashDepositStatus" AS ENUM ('SUBMITTED', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PickupVerification" AS ENUM ('QR', 'CODE');

-- CreateEnum
CREATE TYPE "DeliveryIssueType" AS ENUM ('CUSTOMER_UNREACHABLE', 'WRONG_ADDRESS', 'ITEM_MISSING', 'DAMAGED', 'PAYMENT_REFUSED', 'OTHER');

-- AlterTable
ALTER TABLE "CashCollection" ADD COLUMN     "collectedAmount" DECIMAL(19,3),
ADD COLUMN     "collectedAt" TIMESTAMP(3),
ADD COLUMN     "depositId" UUID;

-- AlterTable
ALTER TABLE "DispatchAssignment" ADD COLUMN     "pickupMethod" "PickupVerification",
ADD COLUMN     "pickupVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "sequence" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "DriverProfile" ADD COLUMN     "lastLatitude" DECIMAL(10,7),
ADD COLUMN     "lastLongitude" DECIMAL(10,7),
ADD COLUMN     "lastSeenAt" TIMESTAMP(3),
ADD COLUMN     "onShift" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "shiftStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "handoffCode" TEXT,
ADD COLUMN     "handoffToken" TEXT;

-- CreateTable
CREATE TABLE "DeliveryLocationCorrection" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "latitude" DECIMAL(10,7) NOT NULL,
    "longitude" DECIMAL(10,7) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryLocationCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryIssue" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "type" "DeliveryIssueType" NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "DeliveryIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashDeposit" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "driverId" UUID NOT NULL,
    "amount" DECIMAL(19,3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BHD',
    "status" "CashDepositStatus" NOT NULL DEFAULT 'SUBMITTED',
    "note" TEXT,
    "reviewNote" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CashDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryLocationCorrection_orderId_idx" ON "DeliveryLocationCorrection"("orderId");

-- CreateIndex
CREATE INDEX "DeliveryIssue_merchantId_status_idx" ON "DeliveryIssue"("merchantId", "status");

-- CreateIndex
CREATE INDEX "DeliveryIssue_orderId_idx" ON "DeliveryIssue"("orderId");

-- CreateIndex
CREATE INDEX "CashDeposit_merchantId_status_idx" ON "CashDeposit"("merchantId", "status");

-- CreateIndex
CREATE INDEX "CashDeposit_driverId_createdAt_idx" ON "CashDeposit"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "CashCollection_driverId_status_idx" ON "CashCollection"("driverId", "status");

-- CreateIndex
CREATE INDEX "DispatchAssignment_driverId_idx" ON "DispatchAssignment"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_handoffToken_key" ON "Order"("handoffToken");

-- AddForeignKey
ALTER TABLE "DeliveryLocationCorrection" ADD CONSTRAINT "DeliveryLocationCorrection_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryIssue" ADD CONSTRAINT "DeliveryIssue_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashCollection" ADD CONSTRAINT "CashCollection_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "CashDeposit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDeposit" ADD CONSTRAINT "CashDeposit_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Grant the delivery app, dispatch planning and cash confirmation to store roles (same as prisma/seed.ts).
INSERT INTO "Permission" ("id", "key")
SELECT gen_random_uuid(), key FROM (VALUES ('delivery.app'), ('cash.confirm'), ('dispatch.manage')) AS wanted(key)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM (VALUES
  ('MERCHANT_OWNER', 'dispatch.manage'), ('MERCHANT_OWNER', 'cash.confirm'),
  ('MERCHANT_MANAGER', 'dispatch.manage'), ('MERCHANT_MANAGER', 'cash.confirm'),
  ('BILLING_STAFF', 'cash.confirm'),
  ('DELIVERY_STAFF', 'delivery.app')
) AS grants(role_key, permission_key)
JOIN "Role" r ON r."key" = grants.role_key
JOIN "Permission" p ON p."key" = grants.permission_key
ON CONFLICT DO NOTHING;
