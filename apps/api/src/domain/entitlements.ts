export class EntitlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntitlementError';
  }
}

export function readEntitlement(
  rows: { key: string; value: unknown }[],
  key: string,
): unknown {
  return rows.find((row) => row.key === key)?.value;
}

export function assertWithinLimit(value: unknown, usage: number, adding = 1, label = 'limit'): void {
  if (value === null || value === undefined || value === '') return;
  const limit = Number(value);
  if (!Number.isFinite(limit)) return;
  if (usage + adding > limit) {
    throw new EntitlementError(`Plan ${label} of ${limit} has been reached`);
  }
}

export function assertFeatureEnabled(value: unknown, label: string): void {
  if (value !== true) {
    throw new EntitlementError(`${label} is not included in the current subscription`);
  }
}

export function commissionPercent(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(3);
  if (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value)) return value;
  throw new EntitlementError('Merchant commission percent is not configured');
}

export const SUGGESTION_MODES = ['ALL_STORES', 'EXCLUDE_SAME_BUSINESS_TYPE', 'CURRENT_STORE_ONLY'] as const;

export type SuggestionMode = (typeof SUGGESTION_MODES)[number];

/** Legacy plan rows stored MARKETPLACE and EXCLUSIVE_STOREFRONT. New plans use SuggestionMode. */
export function suggestionMode(value: unknown): SuggestionMode {
  if (value === 'ALL_STORES' || value === 'MARKETPLACE') return 'ALL_STORES';
  if (value === 'EXCLUDE_SAME_BUSINESS_TYPE') return 'EXCLUDE_SAME_BUSINESS_TYPE';
  if (value === 'CURRENT_STORE_ONLY' || value === 'EXCLUSIVE_STOREFRONT') return 'CURRENT_STORE_ONLY';
  throw new EntitlementError('Subscription visibility is not configured');
}

export function visibilityMode(value: unknown): SuggestionMode {
  return suggestionMode(value);
}

/** A missing flag stays allowed so plans created before the flag existed keep working. An explicit false is enforced. */
export function assertFeatureAllowed(value: unknown, label: string): void {
  if (value === false) {
    throw new EntitlementError(`${label} is not included in the current subscription`);
  }
}
