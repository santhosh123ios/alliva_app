-- AlterEnum
ALTER TYPE "PaymentProvider" ADD VALUE 'TERMINAL';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "billId" UUID;

-- CreateTable
CREATE TABLE "Bill" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "branchId" UUID,
    "number" TEXT NOT NULL,
    "tableId" UUID,
    "method" "PaymentMethod" NOT NULL,
    "subtotal" DECIMAL(19,3) NOT NULL,
    "discount" DECIMAL(19,3) NOT NULL,
    "serviceFee" DECIMAL(19,3) NOT NULL,
    "tax" DECIMAL(19,3) NOT NULL,
    "total" DECIMAL(19,3) NOT NULL,
    "prepaid" DECIMAL(19,3) NOT NULL,
    "collected" DECIMAL(19,3) NOT NULL,
    "tendered" DECIMAL(19,3),
    "change" DECIMAL(19,3),
    "cashDrawerId" UUID,
    "settledById" UUID NOT NULL,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashDrawer" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "branchId" UUID,
    "openingFloat" DECIMAL(19,3) NOT NULL,
    "openedById" UUID NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedAmount" DECIMAL(19,3),
    "countedAmount" DECIMAL(19,3),
    "note" TEXT,
    "closedById" UUID,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "CashDrawer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Bill_merchantId_settledAt_idx" ON "Bill"("merchantId", "settledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Bill_merchantId_number_key" ON "Bill"("merchantId", "number");

-- CreateIndex
CREATE INDEX "CashDrawer_merchantId_closedAt_idx" ON "CashDrawer"("merchantId", "closedAt");

-- CreateIndex
CREATE INDEX "Order_billId_idx" ON "Order"("billId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DiningTable"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_cashDrawerId_fkey" FOREIGN KEY ("cashDrawerId") REFERENCES "CashDrawer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashDrawer" ADD CONSTRAINT "CashDrawer_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Let owners, managers and billing staff settle bills at the till (same as prisma/seed.ts).
INSERT INTO "Permission" ("id", "key")
SELECT gen_random_uuid(), key FROM (VALUES ('bill.settle')) AS wanted(key)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r."id", p."id"
FROM (VALUES ('MERCHANT_OWNER', 'bill.settle'), ('MERCHANT_MANAGER', 'bill.settle'), ('BILLING_STAFF', 'bill.settle')) AS grants(role_key, permission_key)
JOIN "Role" r ON r."key" = grants.role_key
JOIN "Permission" p ON p."key" = grants.permission_key
ON CONFLICT DO NOTHING;
