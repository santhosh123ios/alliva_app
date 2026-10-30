import { businessSetupGaps, type SetupFacts } from './business-setup';

const week = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, opensAt: '08:00', closesAt: '23:00', closed: false }));

function store(patch: Partial<SetupFacts> = {}): SetupFacts {
  return {
    deliveryEnabled: true,
    takeawayEnabled: true,
    dineInEnabled: false,
    freeDeliveryEnabled: false,
    freeDeliveryKm: '0',
    baseDeliveryKm: '3',
    baseDeliveryFee: '1.000',
    maxDeliveryKm: '10',
    branches: [{ latitude: '26.228500', longitude: '50.586000', active: true }],
    hours: week,
    deliverySettings: [],
    ...patch,
  };
}

describe('business setup gaps', () => {
  it('passes a fully set up store', () => {
    expect(businessSetupGaps(store())).toEqual([]);
  });

  it('flags a store with no saved opening hours, like stores created before setup was required', () => {
    expect(businessSetupGaps(store({ hours: [] }))).toEqual(['HOURS']);
  });

  it('flags incomplete or invalid weeks', () => {
    expect(businessSetupGaps(store({ hours: week.slice(0, 6) }))).toEqual(['HOURS']);
    expect(businessSetupGaps(store({ hours: week.map((hour) => ({ ...hour, closed: true })) }))).toEqual(['HOURS']);
    expect(businessSetupGaps(store({ hours: week.map((hour) => ({ ...hour, closesAt: hour.opensAt })) }))).toEqual(['HOURS']);
  });

  it('accepts closed days as long as one day is open', () => {
    expect(businessSetupGaps(store({ hours: week.map((hour) => ({ ...hour, closed: hour.dayOfWeek === 5 })) }))).toEqual([]);
  });

  it('flags a missing or blank map location', () => {
    expect(businessSetupGaps(store({ branches: [] }))).toEqual(['LOCATION']);
    expect(businessSetupGaps(store({ branches: [{ latitude: '0', longitude: '0', active: true }] }))).toEqual(['LOCATION']);
  });

  it('flags a store that offers no order type', () => {
    expect(businessSetupGaps(store({ deliveryEnabled: false, takeawayEnabled: false }))).toEqual(['ORDER_TYPES']);
  });

  it('flags delivery without a delivery area or price', () => {
    expect(businessSetupGaps(store({ maxDeliveryKm: '0' }))).toEqual(['DELIVERY']);
    expect(businessSetupGaps(store({ baseDeliveryFee: '0' }))).toEqual(['DELIVERY']);
    expect(businessSetupGaps(store({ freeDeliveryEnabled: true, freeDeliveryKm: '2' }))).toEqual([]);
  });

  it('accepts detailed delivery pricing instead of the basic fields', () => {
    const basic = { maxDeliveryKm: '0', baseDeliveryKm: '0', baseDeliveryFee: '0' };
    expect(businessSetupGaps(store({ ...basic, deliverySettings: [{ maxRadiusKm: '8', serviceAreaId: null, active: true }] }))).toEqual([]);
    expect(businessSetupGaps(store({ ...basic, deliverySettings: [{ maxRadiusKm: '8', serviceAreaId: 'zone', active: true }] }))).toEqual(['DELIVERY']);
  });

  it('does not ask for delivery pricing when the store does not deliver', () => {
    expect(businessSetupGaps(store({ deliveryEnabled: false, maxDeliveryKm: '0' }))).toEqual([]);
  });

  it('lists every gap at once', () => {
    expect(businessSetupGaps(store({ hours: [], branches: [], maxDeliveryKm: '0' }))).toEqual(['LOCATION', 'HOURS', 'DELIVERY']);
  });
});
