CREATE TYPE "PromoPurpose" AS ENUM ('ORDER', 'SUBSCRIPTION');
CREATE TYPE "MarketingProfileKind" AS ENUM ('HEAD', 'STAFF');
CREATE TYPE "MarketingLeadStatus" AS ENUM ('NEW', 'CONTACTED', 'FOLLOW_UP', 'CONVERTED', 'LOST');
CREATE TYPE "MarketingActivityKind" AS ENUM ('NOTE', 'STATUS', 'FOLLOW_UP', 'STORE_CREATED');
CREATE TYPE "MarketingRedemptionStatus" AS ENUM ('REQUESTED', 'PAID', 'REJECTED');

ALTER TYPE "LedgerType" ADD VALUE 'MARKETING_PAYOUT';

ALTER TABLE "PromoCode" ADD COLUMN "purpose" "PromoPurpose" NOT NULL DEFAULT 'ORDER';

ALTER TABLE "MarketingProfile" ADD COLUMN "kind" "MarketingProfileKind" NOT NULL DEFAULT 'STAFF';
ALTER TABLE "MarketingProfile" ADD COLUMN "promoCodeId" UUID;
ALTER TABLE "MarketingProfile" ALTER COLUMN "referralCode" DROP NOT NULL;
UPDATE "MarketingProfile" SET "kind" = 'HEAD' WHERE "parentUserId" IS NULL;
CREATE UNIQUE INDEX "MarketingProfile_promoCodeId_key" ON "MarketingProfile"("promoCodeId");
ALTER TABLE "MarketingProfile" ADD CONSTRAINT "MarketingProfile_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MerchantReferral" ADD COLUMN "discountType" "PromoDiscountType";
ALTER TABLE "MerchantReferral" ADD COLUMN "discountValue" DECIMAL(19,3);
ALTER TABLE "MerchantReferral" ADD COLUMN "discountAppliedAt" TIMESTAMP(3);
ALTER TABLE "MerchantReferral" ADD COLUMN "pipelineStatus" "MarketingLeadStatus" NOT NULL DEFAULT 'NEW';
ALTER TABLE "MerchantReferral" ADD COLUMN "followUpAt" TIMESTAMP(3);
ALTER TABLE "MerchantReferral" ADD COLUMN "followUpNotifiedAt" TIMESTAMP(3);
ALTER TABLE "MerchantReferral" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "MerchantReferral_marketingUserId_idx" ON "MerchantReferral"("marketingUserId");

CREATE TABLE "MarketingLead" (
    "id" UUID NOT NULL,
    "marketingUserId" UUID NOT NULL,
    "headUserId" UUID,
    "businessName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "city" TEXT,
    "status" "MarketingLeadStatus" NOT NULL DEFAULT 'NEW',
    "followUpAt" TIMESTAMP(3),
    "followUpNotifiedAt" TIMESTAMP(3),
    "merchantId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingLead_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketingActivity" (
    "id" UUID NOT NULL,
    "leadId" UUID,
    "merchantId" UUID,
    "authorId" UUID NOT NULL,
    "kind" "MarketingActivityKind" NOT NULL,
    "body" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingActivity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MarketingWallet" (
    "userId" UUID NOT NULL,
    "balance" DECIMAL(19,3) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'BHD',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingWallet_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "MarketingRedemption" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amount" DECIMAL(19,3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BHD',
    "status" "MarketingRedemptionStatus" NOT NULL DEFAULT 'REQUESTED',
    "termsAcceptedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingRedemption_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketingLead_merchantId_key" ON "MarketingLead"("merchantId");
CREATE INDEX "MarketingLead_marketingUserId_status_idx" ON "MarketingLead"("marketingUserId", "status");
CREATE INDEX "MarketingLead_headUserId_idx" ON "MarketingLead"("headUserId");
CREATE INDEX "MarketingActivity_leadId_idx" ON "MarketingActivity"("leadId");
CREATE INDEX "MarketingActivity_merchantId_idx" ON "MarketingActivity"("merchantId");
CREATE INDEX "MarketingActivity_createdAt_idx" ON "MarketingActivity"("createdAt");
CREATE INDEX "MarketingRedemption_userId_createdAt_idx" ON "MarketingRedemption"("userId", "createdAt");
CREATE INDEX "MarketingRedemption_status_idx" ON "MarketingRedemption"("status");

ALTER TABLE "MarketingLead" ADD CONSTRAINT "MarketingLead_marketingUserId_fkey" FOREIGN KEY ("marketingUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingLead" ADD CONSTRAINT "MarketingLead_headUserId_fkey" FOREIGN KEY ("headUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MarketingLead" ADD CONSTRAINT "MarketingLead_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MarketingActivity" ADD CONSTRAINT "MarketingActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MarketingLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketingActivity" ADD CONSTRAINT "MarketingActivity_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MarketingActivity" ADD CONSTRAINT "MarketingActivity_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingWallet" ADD CONSTRAINT "MarketingWallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MarketingRedemption" ADD CONSTRAINT "MarketingRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
