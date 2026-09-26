import { EntitlementError, suggestionMode } from './entitlements';

export type EntitlementRow = { key: string; value: unknown };

const REQUIRED_KEYS = [
  'visibility',
  'productLimit',
  'monthlyOrderLimit',
  'offerHighlighting',
  'paymentIntegration',
  'deliveryOrdering',
  'takeawayOrdering',
  'tableOrdering',
  'staffLimit',
  'branchLimit',
  'merchantPromoCodes',
  'reporting',
  'transactionalNotifications',
  'promotionalNotifications',
  'supportLevel',
] as const;

const LIMIT_KEYS = ['productLimit', 'monthlyOrderLimit', 'staffLimit', 'branchLimit', 'tableCountLimit'] as const;
const FLAG_KEYS = [
  'offerHighlighting',
  'paymentIntegration',
  'deliveryOrdering',
  'takeawayOrdering',
  'tableOrdering',
  'merchantPromoCodes',
  'transactionalNotifications',
  'promotionalNotifications',
] as const;

/**
 * Monthly order usage is counted inside the subscription's current billing period
 * (currentPeriodStart inclusive, currentPeriodEnd exclusive).
 * Cancelled orders do not consume the limit. Refunded and in-progress orders do,
 * because the order was placed during the paid period.
 */
export function countsTowardMonthlyOrderLimit(status: string) {
  return status !== 'CANCELLED';
}

export function assignmentBlockReason(status: string) {
  if (status === 'ARCHIVED') return 'Archived plans cannot be assigned to new merchants';
  if (status !== 'ACTIVE') return 'Only published plans can be assigned';
  return null;
}

export type SuggestionMerchant = { id: string; businessType: string };

/** QR and shared-link entry. Direct marketplace browsing does not use this filter. */
export function suggestedMerchants<T extends SuggestionMerchant>(input: { mode: ReturnType<typeof suggestionMode>; current: T; candidates: T[] }): T[] {
  const others = input.candidates.filter((merchant) => merchant.id !== input.current.id);
  if (input.mode === 'CURRENT_STORE_ONLY') return [input.current];
  if (input.mode === 'EXCLUDE_SAME_BUSINESS_TYPE') {
    return [input.current, ...others.filter((merchant) => merchant.businessType !== input.current.businessType)];
  }
  return [input.current, ...others];
}

export function validatePlanEntitlements(rows: EntitlementRow[]): EntitlementRow[] {
  const map = new Map(rows.map((row) => [row.key, row.value]));
  for (const key of REQUIRED_KEYS) {
    if (!map.has(key)) throw new EntitlementError(`Plan ${key} is required`);
  }
  suggestionMode(map.get('visibility'));
  map.set('visibility', suggestionMode(map.get('visibility')));
  for (const key of LIMIT_KEYS) {
    if (!map.has(key) && key === 'tableCountLimit') continue;
    map.set(key, limitValue(map.get(key), key));
  }
  for (const key of FLAG_KEYS) {
    if (typeof map.get(key) !== 'boolean') throw new EntitlementError(`Plan ${key} must be on or off`);
  }
  const reporting = map.get('reporting');
  if (reporting !== 'BASIC' && reporting !== 'STANDARD' && reporting !== 'ADVANCED') {
    throw new EntitlementError('Plan reporting must be BASIC, STANDARD, or ADVANCED');
  }
  const support = map.get('supportLevel');
  if (support !== 'STANDARD' && support !== 'PRIORITY') {
    throw new EntitlementError('Plan support level must be STANDARD or PRIORITY');
  }
  const tablesOn = map.get('tableOrdering') === true;
  if (!tablesOn) map.set('tableCountLimit', null);
  else if (!map.has('tableCountLimit')) throw new EntitlementError('Plan tableCountLimit is required when table ordering is on');
  if (!map.has('merchantCommissionPercent')) map.set('merchantCommissionPercent', '10.000');
  if (!map.has('billingIntervals')) map.set('billingIntervals', ['MONTHLY']);
  return [...map.entries()].map(([key, value]) => ({ key, value }));
}

function limitValue(value: unknown, key: string) {
  if (value === null || value === undefined || value === '') return null;
  const limit = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(limit) || limit < 1) throw new EntitlementError(`Plan ${key} must be a positive integer or unlimited`);
  return limit;
}
