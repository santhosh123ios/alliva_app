import { money, moneyString, zero } from './money';

export type DeliveryPricingSettings = {
  freeDeliveryEnabled: boolean;
  freeDeliveryKm: string;
  baseDeliveryKm: string;
  baseDeliveryFee: string;
  beyondFreeDeliveryFee: string;
  beyondDeliveryFeeMode: 'PER_KM' | 'FIXED';
  maxDeliveryKm: string;
};

export function deliveryFeeForDistance(settings: DeliveryPricingSettings, distanceKm: number | null, fallbackFee: string): string {
  const freeKm = nonNegative(settings.freeDeliveryKm);
  const baseKm = nonNegative(settings.baseDeliveryKm);
  const baseFee = nonNegativeMoney(settings.baseDeliveryFee);
  const beyondFee = nonNegativeMoney(settings.beyondFreeDeliveryFee);
  const maxKm = nonNegative(settings.maxDeliveryKm);
  const configured = settings.freeDeliveryEnabled || baseKm > 0 || baseFee.gt(0) || beyondFee.gt(0);

  if (!configured) return moneyString(money(fallbackFee));

  if (distanceKm === null || !Number.isFinite(distanceKm) || distanceKm < 0) {
    return settings.freeDeliveryEnabled ? '0.000' : moneyString(baseFee.gt(0) ? baseFee : money(fallbackFee));
  }
  if (maxKm > 0 && distanceKm > maxKm) throw new Error('Delivery address is outside this store’s delivery area');

  const includedKm = settings.freeDeliveryEnabled ? freeKm : baseKm;
  if (distanceKm <= includedKm) return settings.freeDeliveryEnabled ? '0.000' : moneyString(baseFee);

  if (settings.beyondDeliveryFeeMode === 'FIXED') return moneyString(beyondFee);
  const extraKm = Math.max(0, distanceKm - includedKm);
  const extraFee = beyondFee.mul(extraKm);
  return moneyString(settings.freeDeliveryEnabled ? extraFee : baseFee.plus(extraFee));
}

function nonNegative(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function nonNegativeMoney(value: string) {
  const parsed = money(value || 0);
  return parsed.isNegative() ? zero() : parsed;
}
