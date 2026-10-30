import type { DeliveryPreviewInput, DeliverySettingUpdateInput } from '@alliva/validation';
import { quoteDelivery, type DeliveryRule } from '../domain/delivery-quote';
import type { DeliverySettingRow } from './delivery.service';

/** What the merchant portal shows for one row. Decimals as strings so the form can edit them as typed. */
export function presentDeliverySetting(row: DeliverySettingRow & { createdAt: Date; updatedById: string | null }) {
  return {
    id: row.id,
    branchId: row.branchId,
    serviceAreaId: row.serviceAreaId,
    active: row.active,
    deliveryEnabled: row.deliveryEnabled,
    freeRadiusKm: row.freeRadiusKm.toString(),
    maxRadiusKm: row.maxRadiusKm.toString(),
    includedKm: row.includedKm.toString(),
    baseCharge: row.baseCharge.toString(),
    chargePerStep: row.chargePerStep.toString(),
    billingStepKm: row.billingStepKm.toString(),
    minCharge: row.minCharge?.toString() ?? null,
    maxCharge: row.maxCharge?.toString() ?? null,
    freeAboveOrder: row.freeAboveOrder?.toString() ?? null,
    taxRate: row.taxRate.toString(),
    promoFreeFrom: row.promoFreeFrom?.toISOString() ?? null,
    promoFreeUntil: row.promoFreeUntil?.toISOString() ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    updatedById: row.updatedById,
  };
}

/** Pricing columns from a validated body. Empty optional amounts clear the column. */
export function deliverySettingData(body: Omit<DeliverySettingUpdateInput, 'version'>) {
  return {
    deliveryEnabled: body.deliveryEnabled,
    freeRadiusKm: body.freeRadiusKm,
    maxRadiusKm: body.maxRadiusKm,
    includedKm: body.includedKm ?? '0',
    baseCharge: body.baseCharge,
    chargePerStep: body.chargePerStep,
    billingStepKm: body.billingStepKm,
    minCharge: body.minCharge ?? null,
    maxCharge: body.maxCharge ?? null,
    freeAboveOrder: body.freeAboveOrder ?? null,
    taxRate: body.taxRate,
    promoFreeFrom: body.promoFreeFrom ? new Date(body.promoFreeFrom) : null,
    promoFreeUntil: body.promoFreeUntil ? new Date(body.promoFreeUntil) : null,
  };
}

/** Quotes an unsaved draft at a few distances with the same engine checkout uses, so the preview cannot drift. */
export function previewDeliverySetting(body: DeliveryPreviewInput, now = new Date()) {
  const data = deliverySettingData(body);
  const rule: DeliveryRule = {
    ...data,
    source: 'BRANCH',
    settingId: null,
    version: 0,
    updatedAt: null,
    minCharge: data.minCharge,
    maxCharge: data.maxCharge,
    freeAboveOrder: data.freeAboveOrder,
  };
  return {
    quotes: body.distancesKm.map((distanceKm) => {
      const quote = quoteDelivery({ rule, distanceKm, method: 'HAVERSINE', orderAmount: body.orderAmount ?? null, now });
      return {
        distanceKm: quote.distanceKm,
        available: quote.available,
        reason: quote.reason,
        chargeableKm: quote.chargeableKm,
        billingUnits: quote.billingUnits,
        standardCharge: quote.standardCharge,
        charge: quote.charge,
        tax: quote.tax,
        total: quote.total,
        free: quote.free,
        freeReason: quote.freeReason,
      };
    }),
  };
}
