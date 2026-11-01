import { haversineKm } from '../domain/geo';
import { recordedKm } from './delivery.service';
import { tableDistance } from './dispatch.service';

const store = { latitude: 26.2285, longitude: 50.586 };
const drop = { latitude: 26.2572, longitude: 50.6119 };

describe('reusing measured distances', () => {
  it('uses the distance charged at checkout while the pin has not moved', () => {
    const quote = { distanceKm: '6.601', method: 'ROAD', customer: { latitude: '26.257200', longitude: '50.611900' } };
    expect(recordedKm(quote, drop)).toBe(6.601);
    expect(recordedKm(quote, { latitude: 26.26, longitude: 50.6119 })).toBeNull();
    expect(recordedKm(null, drop)).toBeNull();
    expect(recordedKm({ customer: quote.customer }, drop)).toBeNull();
    expect(recordedKm(quote, null)).toBeNull();
  });

  it('reads road kilometres back out of the dispatch board table', () => {
    const distance = tableDistance({ points: [store, drop], km: [[0, 6.6], [6.4, 0]] });
    expect(distance(store, drop)).toBe(6.6);
    expect(distance(drop, store)).toBe(6.4);
    const elsewhere = { latitude: 26.1, longitude: 50.5 };
    expect(distance(store, elsewhere)).toBe(haversineKm(store, elsewhere));
  });
});
