CREATE TABLE "CatalogProduct" (
    "id" UUID NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "name" JSONB NOT NULL,
    "description" JSONB NOT NULL,
    "imageUrl" TEXT,
    "status" "CatalogCategoryStatus" NOT NULL DEFAULT 'PENDING',
    "submittedByMerchantId" UUID,
    "reviewedById" UUID,
    "reviewNote" TEXT,
    "mergedIntoId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CatalogProduct_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CatalogProduct_normalizedName_key" ON "CatalogProduct"("normalizedName");
CREATE INDEX "CatalogProduct_status_createdAt_idx" ON "CatalogProduct"("status", "createdAt");
CREATE INDEX "CatalogProduct_mergedIntoId_idx" ON "CatalogProduct"("mergedIntoId");

ALTER TABLE "CatalogProduct"
ADD CONSTRAINT "CatalogProduct_mergedIntoId_fkey"
FOREIGN KEY ("mergedIntoId") REFERENCES "CatalogProduct"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Product" ADD COLUMN "catalogProductId" UUID;

INSERT INTO "CatalogProduct" (
  "id", "normalizedName", "aliases", "name", "description", "imageUrl", "status", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  source."normalizedName",
  ARRAY[source."normalizedName"],
  source."name",
  source."description",
  source."imageUrl",
  'APPROVED'::"CatalogCategoryStatus",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT ON ("normalizedName")
    regexp_replace(lower(trim(COALESCE("name"->>'en', "name"->>'ar', 'product'))), '\s+', ' ', 'g') AS "normalizedName",
    "name",
    "description",
    "imageUrl",
    "createdAt"
  FROM "Product"
  WHERE "deletedAt" IS NULL
  ORDER BY "normalizedName", "createdAt"
) AS source;

UPDATE "Product" AS local
SET "catalogProductId" = central."id"
FROM "CatalogProduct" AS central
WHERE central."normalizedName" =
  regexp_replace(lower(trim(COALESCE(local."name"->>'en', local."name"->>'ar', 'product'))), '\s+', ' ', 'g');

CREATE INDEX "Product_catalogProductId_idx" ON "Product"("catalogProductId");

ALTER TABLE "Product"
ADD CONSTRAINT "Product_catalogProductId_fkey"
FOREIGN KEY ("catalogProductId") REFERENCES "CatalogProduct"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
