-- Guest sessions remember the location the customer chose before signing in.
ALTER TABLE "Guest" ADD COLUMN "latitude" DECIMAL(9,6);
ALTER TABLE "Guest" ADD COLUMN "longitude" DECIMAL(9,6);
ALTER TABLE "Guest" ADD COLUMN "locationLabel" TEXT;
ALTER TABLE "Guest" ADD COLUMN "locationSource" TEXT;
ALTER TABLE "Guest" ADD COLUMN "locationUpdatedAt" TIMESTAMP(3);

-- Structured Bahrain address parts and a delivery contact.
ALTER TABLE "Address" ADD COLUMN "building" TEXT;
ALTER TABLE "Address" ADD COLUMN "flat" TEXT;
ALTER TABLE "Address" ADD COLUMN "road" TEXT;
ALTER TABLE "Address" ADD COLUMN "block" TEXT;
ALTER TABLE "Address" ADD COLUMN "area" TEXT;
ALTER TABLE "Address" ADD COLUMN "landmark" TEXT;
ALTER TABLE "Address" ADD COLUMN "contactName" TEXT;
ALTER TABLE "Address" ADD COLUMN "contactPhone" TEXT;

-- The delivery calculation used for an order, kept so later setting changes never alter it.
ALTER TABLE "Order" ADD COLUMN "deliveryQuote" JSONB;

CREATE TABLE "DeliverySetting" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "branchId" UUID,
    "serviceAreaId" UUID,
    "deliveryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "freeRadiusKm" DECIMAL(8,3) NOT NULL DEFAULT 0,
    "maxRadiusKm" DECIMAL(8,3) NOT NULL DEFAULT 0,
    "includedKm" DECIMAL(8,3) NOT NULL DEFAULT 0,
    "baseCharge" DECIMAL(19,3) NOT NULL DEFAULT 0,
    "chargePerStep" DECIMAL(19,3) NOT NULL DEFAULT 0,
    "billingStepKm" DECIMAL(8,3) NOT NULL DEFAULT 1,
    "minCharge" DECIMAL(19,3),
    "maxCharge" DECIMAL(19,3),
    "freeAboveOrder" DECIMAL(19,3),
    "taxRate" DECIMAL(7,5) NOT NULL DEFAULT 0,
    "promoFreeFrom" TIMESTAMP(3),
    "promoFreeUntil" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" UUID,
    CONSTRAINT "DeliverySetting_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DeliverySetting_merchantId_active_idx" ON "DeliverySetting"("merchantId", "active");
CREATE INDEX "DeliverySetting_branchId_idx" ON "DeliverySetting"("branchId");

ALTER TABLE "DeliverySetting" ADD CONSTRAINT "DeliverySetting_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliverySetting" ADD CONSTRAINT "DeliverySetting_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DeliverySetting" ADD CONSTRAINT "DeliverySetting_serviceAreaId_fkey" FOREIGN KEY ("serviceAreaId") REFERENCES "ServiceArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;
