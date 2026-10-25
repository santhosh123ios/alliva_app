-- CreateEnum
CREATE TYPE "MarketingAccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ReferralSource" AS ENUM ('SIGNUP', 'STAFF_PORTAL', 'ADMIN');

-- CreateEnum
CREATE TYPE "SubscriptionPromoState" AS ENUM ('RESERVED', 'APPLIED', 'VOID');

-- CreateEnum
CREATE TYPE "MarketingAppointmentKind" AS ENUM ('APPOINTMENT', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "MarketingAppointmentStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED', 'MISSED', 'RESCHEDULED');

-- CreateEnum
CREATE TYPE "WalletTxType" AS ENUM ('COMMISSION_CREDIT', 'COMMISSION_REVERSAL', 'APPROVAL', 'RECOVERY', 'WITHDRAWAL_RESERVE', 'WITHDRAWAL_RELEASE', 'WITHDRAWAL_PAID', 'ADMIN_ADJUSTMENT', 'OPENING_BALANCE');

-- CreateEnum
CREATE TYPE "WalletBucket" AS ENUM ('PENDING', 'AVAILABLE', 'RESERVED', 'RECOVERY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MarketingActivityKind" ADD VALUE 'LEAD_CREATED';
ALTER TYPE "MarketingActivityKind" ADD VALUE 'VISIT';
ALTER TYPE "MarketingActivityKind" ADD VALUE 'APPOINTMENT';
ALTER TYPE "MarketingActivityKind" ADD VALUE 'FOLLOW_UP_DONE';
ALTER TYPE "MarketingActivityKind" ADD VALUE 'MERCHANT_REGISTERED';
ALTER TYPE "MarketingActivityKind" ADD VALUE 'SUBSCRIPTION_ACTIVATED';
ALTER TYPE "MarketingActivityKind" ADD VALUE 'COMMISSION_EARNED';
ALTER TYPE "MarketingActivityKind" ADD VALUE 'WITHDRAWAL_REQUESTED';
ALTER TYPE "MarketingActivityKind" ADD VALUE 'STAFF_TRANSFERRED';

-- AlterEnum: rename existing lead statuses in place so stored rows keep their meaning
ALTER TYPE "MarketingLeadStatus" RENAME VALUE 'FOLLOW_UP' TO 'FOLLOW_UP_REQUIRED';
ALTER TYPE "MarketingLeadStatus" RENAME VALUE 'CONVERTED' TO 'REGISTERED';
ALTER TYPE "MarketingLeadStatus" RENAME VALUE 'LOST' TO 'CLOSED_LOST';
ALTER TYPE "MarketingLeadStatus" ADD VALUE 'VISITED';
ALTER TYPE "MarketingLeadStatus" ADD VALUE 'INTERESTED';
ALTER TYPE "MarketingLeadStatus" ADD VALUE 'APPOINTMENT_SCHEDULED';
ALTER TYPE "MarketingLeadStatus" ADD VALUE 'NEGOTIATION';
ALTER TYPE "MarketingLeadStatus" ADD VALUE 'REGISTRATION_PENDING';
ALTER TYPE "MarketingLeadStatus" ADD VALUE 'NOT_INTERESTED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "MarketingRedemptionStatus" ADD VALUE 'UNDER_REVIEW';
ALTER TYPE "MarketingRedemptionStatus" ADD VALUE 'APPROVED';
ALTER TYPE "MarketingRedemptionStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "MarketingRedemptionStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "CommissionEntry" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" UUID,
ADD COLUMN     "eligibleAmount" DECIMAL(19,3) NOT NULL DEFAULT 0,
ADD COLUMN     "headUserId" UUID,
ADD COLUMN     "ratePercent" DECIMAL(19,3) NOT NULL DEFAULT 0,
ADD COLUMN     "reversedAmount" DECIMAL(19,3) NOT NULL DEFAULT 0,
ADD COLUMN     "staffUserId" UUID;

-- AlterTable
ALTER TABLE "MarketingActivity" ADD COLUMN     "headUserId" UUID,
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "staffUserId" UUID;

-- AlterTable
ALTER TABLE "MarketingLead" ADD COLUMN     "address" TEXT,
ADD COLUMN     "appointmentAt" TIMESTAMP(3),
ADD COLUMN     "area" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "expectedRegistrationAt" TIMESTAMP(3),
ADD COLUMN     "firstVisitAt" TIMESTAMP(3),
ADD COLUMN     "interestedPlanId" UUID,
ADD COLUMN     "mapsUrl" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "whatsapp" TEXT;

-- AlterTable
ALTER TABLE "MarketingProfile" ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "employeeId" TEXT,
ADD COLUMN     "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "region" TEXT,
ADD COLUMN     "status" "MarketingAccountStatus" NOT NULL DEFAULT 'ACTIVE',
ALTER COLUMN "staffCommissionPercent" DROP NOT NULL,
ALTER COLUMN "headOverridePercent" DROP NOT NULL;

-- AlterTable
ALTER TABLE "MarketingRedemption" ADD COLUMN     "paidById" UUID,
ADD COLUMN     "payoutMethod" TEXT,
ADD COLUMN     "payoutReference" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" UUID;

-- AlterTable
ALTER TABLE "MarketingWallet" ADD COLUMN     "pendingBalance" DECIMAL(19,3) NOT NULL DEFAULT 0,
ADD COLUMN     "recoveryDue" DECIMAL(19,3) NOT NULL DEFAULT 0,
ADD COLUMN     "reservedBalance" DECIMAL(19,3) NOT NULL DEFAULT 0,
ADD COLUMN     "totalEarned" DECIMAL(19,3) NOT NULL DEFAULT 0,
ADD COLUMN     "totalWithdrawn" DECIMAL(19,3) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "MerchantReferral" ADD COLUMN     "commissionPaymentId" UUID,
ADD COLUMN     "headUserId" UUID,
ADD COLUMN     "referralCodeId" UUID,
ADD COLUMN     "source" "ReferralSource" NOT NULL DEFAULT 'SIGNUP',
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "entityType" TEXT,
ADD COLUMN     "link" TEXT;

-- AlterTable
ALTER TABLE "PromoCode" ADD COLUMN     "assignedHeadUserId" UUID,
ADD COLUMN     "assignedUserId" UUID,
ADD COLUMN     "campaignName" TEXT,
ADD COLUMN     "campaignSource" TEXT,
ADD COLUMN     "planIds" JSONB;

-- AlterTable
ALTER TABLE "SubscriptionPayment" ADD COLUMN     "discountAmount" DECIMAL(19,3) NOT NULL DEFAULT 0,
ADD COLUMN     "grossAmount" DECIMAL(19,3),
ADD COLUMN     "promoCodeId" UUID,
ADD COLUMN     "refundedAmount" DECIMAL(19,3) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "MarketingReferralCode" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),
    "createdById" UUID,

    CONSTRAINT "MarketingReferralCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingVisit" (
    "id" UUID NOT NULL,
    "leadId" UUID NOT NULL,
    "staffUserId" UUID NOT NULL,
    "headUserId" UUID,
    "visitedAt" TIMESTAMP(3) NOT NULL,
    "outcome" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAppointment" (
    "id" UUID NOT NULL,
    "kind" "MarketingAppointmentKind" NOT NULL DEFAULT 'APPOINTMENT',
    "leadId" UUID,
    "merchantId" UUID,
    "staffUserId" UUID NOT NULL,
    "headUserId" UUID,
    "title" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "status" "MarketingAppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "outcome" TEXT,
    "notes" TEXT,
    "completedAt" TIMESTAMP(3),
    "rescheduledFromId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingAppointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingWalletTransaction" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "WalletTxType" NOT NULL,
    "bucket" "WalletBucket" NOT NULL,
    "amount" DECIMAL(19,3) NOT NULL,
    "reference" TEXT NOT NULL,
    "reason" TEXT,
    "commissionEntryId" UUID,
    "withdrawalId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingWalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionAdjustment" (
    "id" UUID NOT NULL,
    "commissionEntryId" UUID NOT NULL,
    "refundId" UUID,
    "amount" DECIMAL(19,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPromoRedemption" (
    "id" UUID NOT NULL,
    "promoCodeId" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "subscriptionPaymentId" UUID,
    "discountAmount" DECIMAL(19,3) NOT NULL DEFAULT 0,
    "status" "SubscriptionPromoState" NOT NULL DEFAULT 'RESERVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "SubscriptionPromoRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionRefund" (
    "id" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "merchantId" UUID NOT NULL,
    "amount" DECIMAL(19,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionRefund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingReferralCode_code_key" ON "MarketingReferralCode"("code");

-- CreateIndex
CREATE INDEX "MarketingReferralCode_userId_idx" ON "MarketingReferralCode"("userId");

-- CreateIndex
CREATE INDEX "MarketingVisit_leadId_idx" ON "MarketingVisit"("leadId");

-- CreateIndex
CREATE INDEX "MarketingVisit_staffUserId_visitedAt_idx" ON "MarketingVisit"("staffUserId", "visitedAt");

-- CreateIndex
CREATE INDEX "MarketingVisit_headUserId_idx" ON "MarketingVisit"("headUserId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingAppointment_rescheduledFromId_key" ON "MarketingAppointment"("rescheduledFromId");

-- CreateIndex
CREATE INDEX "MarketingAppointment_staffUserId_status_scheduledAt_idx" ON "MarketingAppointment"("staffUserId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "MarketingAppointment_headUserId_status_scheduledAt_idx" ON "MarketingAppointment"("headUserId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "MarketingAppointment_leadId_idx" ON "MarketingAppointment"("leadId");

-- CreateIndex
CREATE INDEX "MarketingAppointment_status_scheduledAt_idx" ON "MarketingAppointment"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingWalletTransaction_reference_key" ON "MarketingWalletTransaction"("reference");

-- CreateIndex
CREATE INDEX "MarketingWalletTransaction_userId_createdAt_idx" ON "MarketingWalletTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingWalletTransaction_commissionEntryId_idx" ON "MarketingWalletTransaction"("commissionEntryId");

-- CreateIndex
CREATE INDEX "MarketingWalletTransaction_withdrawalId_idx" ON "MarketingWalletTransaction"("withdrawalId");

-- CreateIndex
CREATE INDEX "CommissionAdjustment_commissionEntryId_idx" ON "CommissionAdjustment"("commissionEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionAdjustment_commissionEntryId_refundId_key" ON "CommissionAdjustment"("commissionEntryId", "refundId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionPromoRedemption_subscriptionPaymentId_key" ON "SubscriptionPromoRedemption"("subscriptionPaymentId");

-- CreateIndex
CREATE INDEX "SubscriptionPromoRedemption_promoCodeId_status_idx" ON "SubscriptionPromoRedemption"("promoCodeId", "status");

-- CreateIndex
CREATE INDEX "SubscriptionPromoRedemption_merchantId_idx" ON "SubscriptionPromoRedemption"("merchantId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionRefund_idempotencyKey_key" ON "SubscriptionRefund"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SubscriptionRefund_paymentId_idx" ON "SubscriptionRefund"("paymentId");

-- CreateIndex
CREATE INDEX "CommissionEntry_staffUserId_idx" ON "CommissionEntry"("staffUserId");

-- CreateIndex
CREATE INDEX "CommissionEntry_headUserId_idx" ON "CommissionEntry"("headUserId");

-- CreateIndex
CREATE UNIQUE INDEX "CommissionEntry_subscriptionPaymentId_tier_key" ON "CommissionEntry"("subscriptionPaymentId", "tier");

-- CreateIndex
CREATE INDEX "MarketingActivity_staffUserId_createdAt_idx" ON "MarketingActivity"("staffUserId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingActivity_headUserId_createdAt_idx" ON "MarketingActivity"("headUserId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingLead_phone_idx" ON "MarketingLead"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingProfile_employeeId_key" ON "MarketingProfile"("employeeId");

-- CreateIndex
CREATE INDEX "MarketingProfile_parentUserId_idx" ON "MarketingProfile"("parentUserId");

-- CreateIndex
CREATE INDEX "MarketingProfile_kind_status_idx" ON "MarketingProfile"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantReferral_commissionPaymentId_key" ON "MerchantReferral"("commissionPaymentId");

-- CreateIndex
CREATE INDEX "MerchantReferral_headUserId_idx" ON "MerchantReferral"("headUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- CreateIndex
CREATE INDEX "PromoCode_assignedUserId_idx" ON "PromoCode"("assignedUserId");

-- CreateIndex
CREATE INDEX "PromoCode_purpose_active_idx" ON "PromoCode"("purpose", "active");

-- AddForeignKey
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_assignedHeadUserId_fkey" FOREIGN KEY ("assignedHeadUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingReferralCode" ADD CONSTRAINT "MarketingReferralCode_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "MarketingProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantReferral" ADD CONSTRAINT "MerchantReferral_headUserId_fkey" FOREIGN KEY ("headUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantReferral" ADD CONSTRAINT "MerchantReferral_referralCodeId_fkey" FOREIGN KEY ("referralCodeId") REFERENCES "MarketingReferralCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingLead" ADD CONSTRAINT "MarketingLead_interestedPlanId_fkey" FOREIGN KEY ("interestedPlanId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingVisit" ADD CONSTRAINT "MarketingVisit_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MarketingLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingVisit" ADD CONSTRAINT "MarketingVisit_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAppointment" ADD CONSTRAINT "MarketingAppointment_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MarketingLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAppointment" ADD CONSTRAINT "MarketingAppointment_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAppointment" ADD CONSTRAINT "MarketingAppointment_staffUserId_fkey" FOREIGN KEY ("staffUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAppointment" ADD CONSTRAINT "MarketingAppointment_rescheduledFromId_fkey" FOREIGN KEY ("rescheduledFromId") REFERENCES "MarketingAppointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingWalletTransaction" ADD CONSTRAINT "MarketingWalletTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionAdjustment" ADD CONSTRAINT "CommissionAdjustment_commissionEntryId_fkey" FOREIGN KEY ("commissionEntryId") REFERENCES "CommissionEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPromoRedemption" ADD CONSTRAINT "SubscriptionPromoRedemption_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionRefund" ADD CONSTRAINT "SubscriptionRefund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "SubscriptionPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Backfills (data-preserving; nothing is deleted)
-- ============================================================================

-- Zero commission percentages used to be ignored; NULL now means "use the platform default".
UPDATE "MarketingProfile" SET "staffCommissionPercent" = NULL WHERE "staffCommissionPercent" = 0;
UPDATE "MarketingProfile" SET "headOverridePercent" = NULL WHERE "headOverridePercent" = 0;

-- Referral code history. Only staff codes stay active for attribution; head codes are kept as history.
INSERT INTO "MarketingReferralCode" ("id", "profileId", "userId", "code", "active", "createdAt")
SELECT gen_random_uuid(), p."id", p."userId", upper(p."referralCode"), (p."kind" = 'STAFF'), p."createdAt"
FROM "MarketingProfile" p
WHERE p."referralCode" IS NOT NULL
ON CONFLICT ("code") DO NOTHING;

-- Personal promo codes stay as normal promo codes, now explicitly assigned to their owner.
UPDATE "PromoCode" pc
SET "assignedUserId" = m."userId",
    "assignedHeadUserId" = CASE WHEN m."kind" = 'STAFF' THEN m."parentUserId" ELSE m."userId" END,
    "campaignSource" = COALESCE(pc."campaignSource", 'MARKETING_STAFF'),
    "campaignName" = COALESCE(pc."campaignName", pc."code" || ' referral offer')
FROM "MarketingProfile" m
WHERE m."promoCodeId" = pc."id";

-- Attribution snapshots: head at attribution time, code used, first-payment commission lock.
UPDATE "MerchantReferral" r
SET "headUserId" = m."parentUserId"
FROM "MarketingProfile" m
WHERE m."userId" = r."marketingUserId" AND m."kind" = 'STAFF';

UPDATE "MerchantReferral" r
SET "referralCodeId" = c."id"
FROM "MarketingReferralCode" c
WHERE upper(r."codeUsed") = c."code";

UPDATE "MerchantReferral" r
SET "commissionPaymentId" = (
  SELECT ce."subscriptionPaymentId" FROM "CommissionEntry" ce
  WHERE ce."merchantId" = r."merchantId" ORDER BY ce."createdAt" ASC LIMIT 1
);

-- Merchants that signed up with a (formerly fused) referral code and have not paid yet keep the discount they were
-- promised: it becomes a reserved redemption of the matching promo code. Referral and promo are separate from now on.
INSERT INTO "SubscriptionPromoRedemption" ("id", "promoCodeId", "merchantId", "status")
SELECT gen_random_uuid(), pc."id", r."merchantId", 'RESERVED'
FROM "MerchantReferral" r
JOIN "PromoCode" pc ON upper(pc."code") = upper(r."codeUsed")
WHERE r."discountType" IS NOT NULL AND r."discountAppliedAt" IS NULL AND r."commissionPaymentId" IS NULL;

-- Commission snapshots for historic entries (rate derived from the stored amount).
UPDATE "CommissionEntry" c
SET "eligibleAmount" = p."amount",
    "ratePercent" = CASE WHEN p."amount" > 0 THEN ROUND(c."amount" * 100 / p."amount", 3) ELSE 0 END,
    "approvedAt" = CASE WHEN c."status" IN ('APPROVED', 'PAID') THEN c."createdAt" ELSE NULL END,
    "staffUserId" = r."marketingUserId",
    "headUserId" = COALESCE(r."headUserId", CASE WHEN c."tier" = 'HEAD' THEN c."beneficiaryUserId" ELSE NULL END)
FROM "SubscriptionPayment" p
LEFT JOIN "MerchantReferral" r ON r."merchantId" = p."merchantId"
WHERE p."id" = c."subscriptionPaymentId";

-- Activity scoping columns.
UPDATE "MarketingActivity" a
SET "staffUserId" = l."marketingUserId", "headUserId" = l."headUserId"
FROM "MarketingLead" l WHERE a."leadId" = l."id";
UPDATE "MarketingActivity" a
SET "staffUserId" = r."marketingUserId", "headUserId" = r."headUserId"
FROM "MerchantReferral" r WHERE a."leadId" IS NULL AND a."merchantId" = r."merchantId";

-- Existing follow-up dates become appointment/follow-up tasks so reminders keep working.
INSERT INTO "MarketingAppointment" ("id", "kind", "leadId", "staffUserId", "headUserId", "title", "scheduledAt", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'FOLLOW_UP', l."id", l."marketingUserId", l."headUserId", 'Follow-up: ' || l."businessName", l."followUpAt", 'SCHEDULED', now(), now()
FROM "MarketingLead" l WHERE l."followUpAt" IS NOT NULL;

INSERT INTO "MarketingAppointment" ("id", "kind", "merchantId", "staffUserId", "headUserId", "title", "scheduledAt", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'FOLLOW_UP', r."merchantId", r."marketingUserId", r."headUserId", 'Follow-up: store', r."followUpAt", 'SCHEDULED', now(), now()
FROM "MerchantReferral" r WHERE r."followUpAt" IS NOT NULL;

-- Every marketing member gets a wallet row so the ledger always has a row to lock.
INSERT INTO "MarketingWallet" ("userId", "updatedAt")
SELECT p."userId", now() FROM "MarketingProfile" p
ON CONFLICT ("userId") DO NOTHING;

-- Wallet ledger opening balances: the old mutable balance becomes the first ledger row.
INSERT INTO "MarketingWalletTransaction" ("id", "userId", "type", "bucket", "amount", "reference", "reason")
SELECT gen_random_uuid(), w."userId", 'OPENING_BALANCE', 'AVAILABLE', w."balance", 'opening:' || w."userId", 'Balance carried from the previous wallet'
FROM "MarketingWallet" w WHERE w."balance" > 0;

-- Withdrawals still waiting were already deducted from the balance: they are the reserved bucket.
INSERT INTO "MarketingWalletTransaction" ("id", "userId", "type", "bucket", "amount", "reference", "reason", "withdrawalId")
SELECT gen_random_uuid(), r."userId", 'OPENING_BALANCE', 'RESERVED', r."amount", 'opening-reserve:' || r."id", 'Pending withdrawal carried from the previous wallet', r."id"
FROM "MarketingRedemption" r WHERE r."status" = 'REQUESTED';

UPDATE "MarketingWallet" w
SET "reservedBalance" = COALESCE((SELECT SUM(r."amount") FROM "MarketingRedemption" r WHERE r."userId" = w."userId" AND r."status" = 'REQUESTED'), 0),
    "totalEarned" = COALESCE((SELECT SUM(c."amount") FROM "CommissionEntry" c WHERE c."beneficiaryUserId" = w."userId" AND c."status" IN ('APPROVED', 'PAID')), 0),
    "totalWithdrawn" = COALESCE((SELECT SUM(r."amount") FROM "MarketingRedemption" r WHERE r."userId" = w."userId" AND r."status" = 'PAID'), 0);

-- ============================================================================
-- Database-level financial guards
-- ============================================================================
ALTER TABLE "MarketingWallet" ADD CONSTRAINT "MarketingWallet_buckets_nonnegative"
  CHECK ("balance" >= 0 AND "pendingBalance" >= 0 AND "reservedBalance" >= 0 AND "recoveryDue" >= 0);
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_refund_bounds"
  CHECK ("refundedAmount" >= 0 AND "refundedAmount" <= "amount");
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_reversal_bounds"
  CHECK ("reversedAmount" >= 0 AND "reversedAmount" <= "amount");
