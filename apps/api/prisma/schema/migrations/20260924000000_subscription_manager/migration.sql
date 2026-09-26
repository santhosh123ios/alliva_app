-- Additive subscription manager fields. Existing plans, entitlements, and subscriptions are left in place.
ALTER TABLE "SubscriptionPlan" ADD COLUMN "displayOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SubscriptionPlan" ADD COLUMN "recommended" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "MerchantSubscription" ADD COLUMN "entitlementSnapshot" JSONB;
ALTER TABLE "MerchantSubscription" ADD COLUMN "pendingPlanId" UUID;
ALTER TABLE "MerchantSubscription" ADD COLUMN "pendingBillingInterval" "BillingInterval";
ALTER TABLE "MerchantSubscription" ADD COLUMN "pendingEffectiveAt" TIMESTAMP(3);
ALTER TABLE "MerchantSubscription" ADD COLUMN "pendingMarkPaid" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "MerchantSubscription" ADD CONSTRAINT "MerchantSubscription_pendingPlanId_fkey" FOREIGN KEY ("pendingPlanId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "SubscriptionChange" (
    "id" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "subscriptionId" UUID,
    "fromPlanId" UUID,
    "toPlanId" UUID NOT NULL,
    "billingInterval" "BillingInterval" NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "actorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SubscriptionChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SubscriptionChange_merchantId_idx" ON "SubscriptionChange"("merchantId");

ALTER TABLE "SubscriptionChange" ADD CONSTRAINT "SubscriptionChange_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionChange" ADD CONSTRAINT "SubscriptionChange_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "MerchantSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubscriptionChange" ADD CONSTRAINT "SubscriptionChange_fromPlanId_fkey" FOREIGN KEY ("fromPlanId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SubscriptionChange" ADD CONSTRAINT "SubscriptionChange_toPlanId_fkey" FOREIGN KEY ("toPlanId") REFERENCES "SubscriptionPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
