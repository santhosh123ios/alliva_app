/** Details a store must save before customers can order from it. */
export type SetupGap = 'ORDER_TYPES' | 'LOCATION' | 'HOURS' | 'DELIVERY';

type Decimalish = { toString(): string } | string | number;

export type SetupFacts = {
  deliveryEnabled: boolean;
  takeawayEnabled: boolean;
  dineInEnabled: boolean;
  freeDeliveryEnabled: boolean;
  freeDeliveryKm: Decimalish;
  baseDeliveryKm: Decimalish;
  baseDeliveryFee: Decimalish;
  maxDeliveryKm: Decimalish;
  branches: { latitude: Decimalish; longitude: Decimalish; active: boolean; createdAt?: Date }[];
  hours: { dayOfWeek: number; opensAt: string; closesAt: string; closed: boolean }[];
  /** Active rows from the detailed delivery pricing (`DeliverySetting`). */
  deliverySettings?: { maxRadiusKm: Decimalish; serviceAreaId: string | null; active: boolean }[];
};

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * What a store still has to save, judged from its data rather than a stored "done" flag,
 * so stores created before a requirement existed are caught too. Mirrors the checks of
 * `POST /merchant/business-setup`.
 */
export function businessSetupGaps(store: SetupFacts): SetupGap[] {
  const gaps: SetupGap[] = [];
  if (!store.deliveryEnabled && !store.takeawayEnabled && !store.dineInEnabled) gaps.push('ORDER_TYPES');
  const branch = store.branches.find((row) => row.active) ?? null;
  const lat = Number(branch?.latitude?.toString());
  const lng = Number(branch?.longitude?.toString());
  if (!branch || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0) || Math.abs(lat) > 90 || Math.abs(lng) > 180) gaps.push('LOCATION');
  if (!hoursReady(store.hours)) gaps.push('HOURS');
  if (store.deliveryEnabled && !deliveryPriced(store)) gaps.push('DELIVERY');
  return gaps;
}

/** True when the detailed pricing gives the store (or a branch) a delivery area, so the basic fields are optional. */
export function detailedDeliveryPricing(store: Pick<SetupFacts, 'deliverySettings'>) {
  return (store.deliverySettings ?? []).some((row) => row.active && !row.serviceAreaId && positive(row.maxRadiusKm));
}

function deliveryPriced(store: SetupFacts) {
  if (detailedDeliveryPricing(store)) return true;
  if (!positive(store.maxDeliveryKm)) return false;
  return store.freeDeliveryEnabled ? positive(store.freeDeliveryKm) : positive(store.baseDeliveryKm) && positive(store.baseDeliveryFee);
}

function hoursReady(hours: SetupFacts['hours']) {
  const days = new Set(hours.map((hour) => hour.dayOfWeek));
  if (hours.length !== 7 || days.size !== 7) return false;
  if (!hours.some((hour) => !hour.closed)) return false;
  return hours.every((hour) => hour.dayOfWeek >= 0 && hour.dayOfWeek <= 6 && (hour.closed || (TIME.test(hour.opensAt) && TIME.test(hour.closesAt) && hour.opensAt !== hour.closesAt)));
}

function positive(value: Decimalish) {
  const number = Number(value?.toString());
  return Number.isFinite(number) && number > 0;
}
