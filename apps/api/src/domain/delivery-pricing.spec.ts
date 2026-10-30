import assert from 'node:assert/strict';
import test from 'node:test';
import { deliveryFeeForDistance, type DeliveryPricingSettings } from './delivery-pricing';

const settings: DeliveryPricingSettings = {
  freeDeliveryEnabled: false,
  freeDeliveryKm: '0',
  baseDeliveryKm: '3',
  baseDeliveryFee: '1.000',
  beyondFreeDeliveryFee: '0.250',
  beyondDeliveryFeeMode: 'PER_KM',
  maxDeliveryKm: '10',
};

test('charges the base fee inside the base delivery range', () => {
  assert.equal(deliveryFeeForDistance(settings, 2.5, '0.500'), '1.000');
});

test('adds a per-km charge after the base range', () => {
  assert.equal(deliveryFeeForDistance(settings, 5, '0.500'), '1.500');
});

test('supports free delivery followed by per-km pricing', () => {
  assert.equal(deliveryFeeForDistance({ ...settings, freeDeliveryEnabled: true, freeDeliveryKm: '2' }, 4, '0.500'), '0.500');
});

test('supports a fixed total price after the included range', () => {
  assert.equal(deliveryFeeForDistance({ ...settings, beyondDeliveryFeeMode: 'FIXED', beyondFreeDeliveryFee: '2.000' }, 5, '0.500'), '2.000');
});

test('rejects addresses outside the maximum delivery area', () => {
  assert.throws(() => deliveryFeeForDistance(settings, 11, '0.500'), /outside/);
});

test('keeps the platform fallback for stores not configured yet', () => {
  assert.equal(deliveryFeeForDistance({ ...settings, baseDeliveryKm: '0', baseDeliveryFee: '0', beyondFreeDeliveryFee: '0' }, 4, '0.500'), '0.500');
});
