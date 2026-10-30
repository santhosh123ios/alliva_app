import {
  acceptedPaymentMethods,
  defaultPaymentMethods,
  isOfflinePaymentMethod,
  parsePaymentMethods,
  paymentMethodsSettingSchema,
  resolveRegistrationMethods,
} from '@alliva/validation';

const ALL = ['CASH', 'BANK_TRANSFER', 'BENEFIT_PAY', 'TAP_PAY', 'PAYPAL'];

describe('payment methods', () => {
  it('offers cash on delivery, bank transfer, BenefitPay, Tap Pay and PayPal, and ignores unknown rows', () => {
    const parsed = parsePaymentMethods([
      { code: 'PAYPAL', enabled: false, name: { en: 'PayPal checkout', ar: 'باي بال' } },
      { code: 'NOPE', enabled: true, name: { en: 'Nope', ar: 'لا' } },
    ]);
    expect(parsed.map((row) => row.code)).toEqual(ALL);
    expect(parsed.find((row) => row.code === 'PAYPAL')).toMatchObject({ enabled: false, name: { en: 'PayPal checkout', ar: 'باي بال' } });
    expect(parsed.find((row) => row.code === 'TAP_PAY')?.enabled).toBe(true);
  });

  it('falls back to the defaults when the saved catalog only holds retired methods', () => {
    const parsed = parsePaymentMethods([
      { code: 'CARD', enabled: false, name: { en: 'Card', ar: 'بطاقة' } },
    ]);
    expect(parsed).toEqual(defaultPaymentMethods());
  });

  it('rejects a catalog that turns every method off', () => {
    const off = defaultPaymentMethods().map((row) => ({ ...row, enabled: false }));
    expect(paymentMethodsSettingSchema.safeParse(off).success).toBe(false);
    expect(paymentMethodsSettingSchema.safeParse(defaultPaymentMethods()).success).toBe(true);
  });

  it('offers only enabled methods at registration and keeps a store on the ones it accepted', () => {
    const catalog = defaultPaymentMethods().map((row) => (row.code === 'TAP_PAY' ? { ...row, enabled: false } : row));
    expect(resolveRegistrationMethods(undefined, catalog)).toEqual(['CASH', 'BANK_TRANSFER', 'BENEFIT_PAY', 'PAYPAL']);
    expect(resolveRegistrationMethods(['PAYPAL', 'TAP_PAY'], catalog)).toBeNull();
    expect(resolveRegistrationMethods(['PAYPAL', 'PAYPAL'], catalog)).toEqual(['PAYPAL']);
    expect(acceptedPaymentMethods(['TAP_PAY', 'PAYPAL'], catalog)).toEqual(['PAYPAL']);
    expect(acceptedPaymentMethods(null, catalog)).toEqual(['CASH', 'BANK_TRANSFER', 'BENEFIT_PAY', 'PAYPAL']);
  });

  it('carries stores that saved a retired method over to its replacement', () => {
    const catalog = defaultPaymentMethods();
    expect(acceptedPaymentMethods(['CARD', 'BENEFIT'], catalog)).toEqual(['BENEFIT_PAY', 'TAP_PAY']);
    expect(acceptedPaymentMethods(['CASH'], catalog)).toEqual(['CASH']);
  });

  it('treats cash on delivery and bank transfer as settled outside a gateway', () => {
    expect(isOfflinePaymentMethod('CASH')).toBe(true);
    expect(isOfflinePaymentMethod('BANK_TRANSFER')).toBe(true);
    expect(['BENEFIT_PAY', 'TAP_PAY', 'PAYPAL'].some(isOfflinePaymentMethod)).toBe(false);
  });
});
