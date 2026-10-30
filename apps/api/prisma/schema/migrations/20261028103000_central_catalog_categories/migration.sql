CREATE TYPE "CatalogCategoryStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "CatalogCategory" (
    "id" UUID NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "name" JSONB NOT NULL,
    "icon" TEXT,
    "status" "CatalogCategoryStatus" NOT NULL DEFAULT 'PENDING',
    "submittedByMerchantId" UUID,
    "reviewedById" UUID,
    "reviewNote" TEXT,
    "mergedIntoId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CatalogCategory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogCategory_normalizedName_key" ON "CatalogCategory"("normalizedName");
CREATE INDEX "CatalogCategory_status_createdAt_idx" ON "CatalogCategory"("status", "createdAt");
CREATE INDEX "CatalogCategory_mergedIntoId_idx" ON "CatalogCategory"("mergedIntoId");

ALTER TABLE "CatalogCategory"
ADD CONSTRAINT "CatalogCategory_mergedIntoId_fkey"
FOREIGN KEY ("mergedIntoId") REFERENCES "CatalogCategory"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductCategory" ADD COLUMN "catalogCategoryId" UUID;

INSERT INTO "CatalogCategory" ("id", "normalizedName", "name", "status", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  source."normalizedName",
  source."name",
  'APPROVED'::"CatalogCategoryStatus",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON ("normalizedName")
    regexp_replace(lower(trim(COALESCE("name"->>'en', "name"->>'ar', 'category'))), '\s+', ' ', 'g') AS "normalizedName",
    "name"
  FROM "ProductCategory"
  ORDER BY "normalizedName", "createdAt"
) AS source;

UPDATE "ProductCategory" AS local
SET "catalogCategoryId" = central."id"
FROM "CatalogCategory" AS central
WHERE central."normalizedName" =
  regexp_replace(lower(trim(COALESCE(local."name"->>'en', local."name"->>'ar', 'category'))), '\s+', ' ', 'g');

CREATE INDEX "ProductCategory_catalogCategoryId_idx" ON "ProductCategory"("catalogCategoryId");

ALTER TABLE "ProductCategory"
ADD CONSTRAINT "ProductCategory_catalogCategoryId_fkey"
FOREIGN KEY ("catalogCategoryId") REFERENCES "CatalogCategory"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
