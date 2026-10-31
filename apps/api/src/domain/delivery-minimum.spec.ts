import { deliveryShortfall } from './pricing';

describe('delivery minimum order', () => {
  it('reports how much is missing below the minimum', () => {
    expect(deliveryShortfall('5.000', '3.250')).toBe('1.750');
  });

  it('is met at or above the minimum, and when the store has none', () => {
    expect(deliveryShortfall('5.000', '5.000')).toBeNull();
    expect(deliveryShortfall('5.000', '7.100')).toBeNull();
    expect(deliveryShortfall('0.000', '0.500')).toBeNull();
  });
});
