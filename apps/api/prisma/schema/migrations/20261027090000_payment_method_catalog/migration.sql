-- The platform now offers four payment methods: bank transfer, BenefitPay, Tap Pay and PayPal.
-- Existing enum values stay because historical orders and payments still reference them.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'BANK_TRANSFER';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'TAP_PAY';
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'PAYPAL';
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'PAYPAL';
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'BANK_TRANSFER';

-- Stores that saved a retired method keep the closest replacement (card -> Tap Pay, Benefit -> BenefitPay).
-- Cash has no replacement. A store left with nothing falls back to "accept every enabled method" (NULL).
UPDATE "Merchant"
SET "acceptedPaymentMethods" = CASE
  WHEN converted.methods IS NULL OR jsonb_array_length(converted.methods) = 0 THEN NULL
  ELSE converted.methods
END
FROM (
  SELECT m.id,
    (
      SELECT jsonb_agg(DISTINCT mapped.code)
      FROM (
        SELECT CASE value
          WHEN 'CARD' THEN 'TAP_PAY'
          WHEN 'BENEFIT' THEN 'BENEFIT_PAY'
          WHEN 'BENEFIT_PAY' THEN 'BENEFIT_PAY'
          WHEN 'BANK_TRANSFER' THEN 'BANK_TRANSFER'
          WHEN 'TAP_PAY' THEN 'TAP_PAY'
          WHEN 'PAYPAL' THEN 'PAYPAL'
          ELSE NULL
        END AS code
        FROM jsonb_array_elements_text(m."acceptedPaymentMethods") AS value
      ) AS mapped
      WHERE mapped.code IS NOT NULL
    ) AS methods
  FROM "Merchant" m
  WHERE jsonb_typeof(m."acceptedPaymentMethods") = 'array'
) AS converted
WHERE "Merchant".id = converted.id;

-- Drop the saved catalog of retired methods so the admin starts from the four new ones (all enabled).
DELETE FROM "PlatformSetting" WHERE "key" = 'paymentMethods';

INSERT INTO "PaymentGatewayConfig" ("id", "provider", "enabled", "publicConfig", "updatedAt")
VALUES (gen_random_uuid(), 'PAYPAL', true, '{"feeRate":"0.025"}'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("provider") DO NOTHING;
