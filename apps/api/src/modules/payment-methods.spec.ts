import { acceptedPaymentMethods, defaultPaymentMethods, parsePaymentMethods, paymentMethodsSettingSchema, resolveRegistrationMethods } from '@alliva/validation';

describe('payment methods', () => {
  it('keeps the four methods and ignores unknown rows', () => {
    const parsed = parsePaymentMethods([
      { code: 'CASH', enabled: false, name: { en: 'Cash on delivery', ar: 'الدفع نقداً' } },
      { code: 'NOPE', enabled: true, name: { en: 'Nope', ar: 'لا' } },
    ]);
    expect(parsed.map((row) => row.code)).toEqual(['CARD', 'BENEFIT', 'BENEFIT_PAY', 'CASH']);
    expect(parsed.find((row) => row.code === 'CASH')).toMatchObject({ enabled: false, name: { en: 'Cash on delivery', ar: 'الدفع نقداً' } });
    expect(parsed.find((row) => row.code === 'CARD')?.enabled).toBe(true);
  });

  it('rejects a catalog that turns every method off', () => {
    const off = defaultPaymentMethods().map((row) => ({ ...row, enabled: false }));
    expect(paymentMethodsSettingSchema.safeParse(off).success).toBe(false);
    expect(paymentMethodsSettingSchema.safeParse(defaultPaymentMethods()).success).toBe(true);
  });

  it('offers only enabled methods at registration and keeps a store on the ones it accepted', () => {
    const catalog = defaultPaymentMethods().map((row) => (row.code === 'CARD' ? { ...row, enabled: false } : row));
    expect(resolveRegistrationMethods(undefined, catalog)).toEqual(['BENEFIT', 'BENEFIT_PAY', 'CASH']);
    expect(resolveRegistrationMethods(['CASH', 'CARD'], catalog)).toBeNull();
    expect(resolveRegistrationMethods(['CASH', 'CASH'], catalog)).toEqual(['CASH']);
    expect(acceptedPaymentMethods(['CARD', 'CASH'], catalog)).toEqual(['CASH']);
    expect(acceptedPaymentMethods(null, catalog)).toEqual(['BENEFIT', 'BENEFIT_PAY', 'CASH']);
  });
});
