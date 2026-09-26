import type { SubscriptionPlanView } from '@alliva/types';

export type Visibility = 'ALL_STORES' | 'EXCLUDE_SAME_BUSINESS_TYPE' | 'CURRENT_STORE_ONLY';

export type PlanForm = {
  code: string;
  nameEn: string;
  nameAr: string;
  descriptionEn: string;
  descriptionAr: string;
  priceMonthly: string;
  priceAnnual: string;
  status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
  displayOrder: string;
  recommended: boolean;
  billingCycle: 'MONTHLY' | 'ANNUAL';
  visibility: Visibility;
  productLimit: string;
  monthlyOrderLimit: string;
  offerHighlighting: boolean;
  paymentIntegration: boolean;
  deliveryOrdering: boolean;
  takeawayOrdering: boolean;
  tableOrdering: boolean;
  tableCountLimit: string;
  staffLimit: string;
  branchLimit: string;
  merchantPromoCodes: boolean;
  reporting: 'BASIC' | 'STANDARD' | 'ADVANCED';
  transactionalNotifications: boolean;
  promotionalNotifications: boolean;
  supportLevel: 'STANDARD' | 'PRIORITY';
};

export const emptyForm = (): PlanForm => ({
  code: '',
  nameEn: '',
  nameAr: '',
  descriptionEn: '',
  descriptionAr: '',
  priceMonthly: '10.000',
  priceAnnual: '120.000',
  status: 'DRAFT',
  displayOrder: '0',
  recommended: false,
  billingCycle: 'MONTHLY',
  visibility: 'ALL_STORES',
  productLimit: '',
  monthlyOrderLimit: '',
  offerHighlighting: false,
  paymentIntegration: false,
  deliveryOrdering: true,
  takeawayOrdering: true,
  tableOrdering: false,
  tableCountLimit: '',
  staffLimit: '',
  branchLimit: '1',
  merchantPromoCodes: false,
  reporting: 'BASIC',
  transactionalNotifications: true,
  promotionalNotifications: false,
  supportLevel: 'STANDARD',
});

export function formFromPlan(plan: SubscriptionPlanView): PlanForm {
  const read = (key: string) => plan.entitlements.find((row) => row.key === key)?.value;
  const visibility = read('visibility');
  const mode: Visibility = visibility === 'CURRENT_STORE_ONLY' || visibility === 'EXCLUSIVE_STOREFRONT'
    ? 'CURRENT_STORE_ONLY'
    : visibility === 'EXCLUDE_SAME_BUSINESS_TYPE'
      ? 'EXCLUDE_SAME_BUSINESS_TYPE'
      : 'ALL_STORES';
  const text = (key: string) => {
    const value = read(key);
    return value === null || value === undefined ? '' : String(value);
  };
  const flag = (key: string, fallback: boolean) => {
    const value = read(key);
    return typeof value === 'boolean' ? value : fallback;
  };
  const intervals = read('billingIntervals');
  const annualOnly = Array.isArray(intervals) && intervals.includes('ANNUAL') && !intervals.includes('MONTHLY');
  return {
    code: plan.code,
    nameEn: plan.name.en,
    nameAr: plan.name.ar,
    descriptionEn: plan.description.en,
    descriptionAr: plan.description.ar,
    priceMonthly: plan.priceMonthly,
    priceAnnual: plan.priceAnnual,
    status: plan.status === 'ARCHIVED' ? 'ARCHIVED' : plan.status === 'DRAFT' ? 'DRAFT' : 'ACTIVE',
    displayOrder: String(plan.displayOrder ?? 0),
    recommended: Boolean(plan.recommended),
    billingCycle: annualOnly ? 'ANNUAL' : 'MONTHLY',
    visibility: mode,
    productLimit: text('productLimit'),
    monthlyOrderLimit: text('monthlyOrderLimit'),
    offerHighlighting: flag('offerHighlighting', false),
    paymentIntegration: flag('paymentIntegration', false),
    deliveryOrdering: flag('deliveryOrdering', true),
    takeawayOrdering: flag('takeawayOrdering', true),
    tableOrdering: flag('tableOrdering', false),
    tableCountLimit: text('tableCountLimit'),
    staffLimit: text('staffLimit'),
    branchLimit: text('branchLimit'),
    merchantPromoCodes: flag('merchantPromoCodes', false),
    reporting: read('reporting') === 'ADVANCED' || read('reporting') === 'STANDARD' ? read('reporting') as PlanForm['reporting'] : 'BASIC',
    transactionalNotifications: flag('transactionalNotifications', true),
    promotionalNotifications: flag('promotionalNotifications', false),
    supportLevel: read('supportLevel') === 'PRIORITY' ? 'PRIORITY' : 'STANDARD',
  };
}

export function toEntitlements(form: PlanForm, existing: { key: string; value: unknown }[] = []) {
  const limit = (value: string) => (value.trim() === '' ? null : Number(value));
  const rows: { key: string; value: unknown }[] = [
    { key: 'visibility', value: form.visibility },
    { key: 'productLimit', value: limit(form.productLimit) },
    { key: 'monthlyOrderLimit', value: limit(form.monthlyOrderLimit) },
    { key: 'offerHighlighting', value: form.offerHighlighting },
    { key: 'paymentIntegration', value: form.paymentIntegration },
    { key: 'deliveryOrdering', value: form.deliveryOrdering },
    { key: 'takeawayOrdering', value: form.takeawayOrdering },
    { key: 'tableOrdering', value: form.tableOrdering },
    { key: 'tableCountLimit', value: form.tableOrdering ? limit(form.tableCountLimit) : null },
    { key: 'staffLimit', value: limit(form.staffLimit) },
    { key: 'branchLimit', value: limit(form.branchLimit) },
    { key: 'merchantPromoCodes', value: form.merchantPromoCodes },
    { key: 'reporting', value: form.reporting },
    { key: 'transactionalNotifications', value: form.transactionalNotifications },
    { key: 'promotionalNotifications', value: form.promotionalNotifications },
    { key: 'supportLevel', value: form.supportLevel },
    { key: 'billingIntervals', value: [form.billingCycle] },
  ];
  for (const key of ['merchantCommissionPercent', 'bannerAdvertising']) {
    const found = existing.find((row) => row.key === key);
    if (found) rows.push(found);
  }
  return rows;
}

export function moneyInput(value: string) {
  const [whole, fraction = ''] = value.trim().split('.');
  return `${whole || '0'}.${fraction.padEnd(3, '0').slice(0, 3)}`;
}

export function annualFromMonthly(value: string) {
  const fils = Math.round(Number(moneyInput(value)) * 1000);
  const annual = Number.isFinite(fils) ? fils * 12 : 0;
  const whole = Math.trunc(annual / 1000);
  const fraction = String(Math.abs(annual % 1000)).padStart(3, '0');
  return `${whole}.${fraction}`;
}

export function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const positive = (value: string) => value.trim() === '' || (/^\d+$/.test(value.trim()) && Number(value) >= 1);

export function validatePlanStep(form: PlanForm, step: number) {
  if (step === 0) {
    if (!form.nameEn.trim()) return 'name';
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(form.code.trim().toLowerCase())) return 'code';
    if (!/^\d+(\.\d{1,3})?$/.test(form.priceMonthly.trim())) return 'price';
    if (form.descriptionEn.trim().length > 160) return 'description';
    if (!/^\d+$/.test(form.displayOrder.trim())) return 'order';
  }
  if (step === 2) {
    if (!positive(form.productLimit) || !positive(form.monthlyOrderLimit)) return 'limit';
    if (form.tableOrdering && !positive(form.tableCountLimit)) return 'tables';
  }
  if (step === 3 && (!positive(form.staffLimit) || !positive(form.branchLimit))) return 'limit';
  return '';
}

export function validatePlan(form: PlanForm) {
  for (let step = 0; step <= 3; step += 1) {
    const code = validatePlanStep(form, step);
    if (code) return { step, code };
  }
  return null;
}
