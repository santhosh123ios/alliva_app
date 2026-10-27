CREATE TYPE "CustomerWithdrawalStatus" AS ENUM ('REQUESTED', 'PAID', 'REJECTED');

CREATE TABLE "CustomerWithdrawal" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "amount" DECIMAL(19,3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BHD',
    "status" "CustomerWithdrawalStatus" NOT NULL DEFAULT 'REQUESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerWithdrawal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CustomerWithdrawal_customerId_status_idx" ON "CustomerWithdrawal"("customerId", "status");

ALTER TABLE "CustomerWithdrawal" ADD CONSTRAINT "CustomerWithdrawal_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
