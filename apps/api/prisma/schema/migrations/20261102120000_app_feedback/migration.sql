-- CreateTable
CREATE TABLE "AppFeedback" (
    "id" UUID NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "source" TEXT NOT NULL,
    "orderId" UUID,
    "merchantId" UUID,
    "customerId" UUID,
    "guestId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AppFeedback_orderId_key" ON "AppFeedback"("orderId");

-- CreateIndex
CREATE INDEX "AppFeedback_createdAt_idx" ON "AppFeedback"("createdAt");

-- CreateIndex
CREATE INDEX "AppFeedback_merchantId_createdAt_idx" ON "AppFeedback"("merchantId", "createdAt");
