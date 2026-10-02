'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const areas = [
  { id: 'manama', en: 'Manama', ar: 'المنامة', lat: '26.228500', lng: '50.586000' },
  { id: 'muharraq', en: 'Muharraq', ar: 'المحرق', lat: '26.257200', lng: '50.611900' },
  { id: 'riffa', en: 'Riffa', ar: 'الرفاع', lat: '26.130000', lng: '50.555000' },
  { id: 'isa-town', en: 'Isa Town', ar: 'مدينة عيسى', lat: '26.173600', lng: '50.547800' },
];

export type FulfillmentMode = 'DELIVERY' | 'TAKEAWAY' | 'DINE_IN';

type PlaceState = {
  area: string;
  setArea: (area: string) => void;
  query: string;
  setQuery: (query: string) => void;
  fulfillment: FulfillmentMode;
  setFulfillment: (fulfillment: FulfillmentMode) => void;
};

export const usePlace = create<PlaceState>()(
  persist(
    (set) => ({
      area: 'manama',
      setArea: (area) => set({ area }),
      query: '',
      setQuery: (query) => set({ query }),
      fulfillment: 'DELIVERY',
      setFulfillment: (fulfillment) => set({ fulfillment }),
    }),
    { name: 'alliva-place', partialize: (state) => ({ area: state.area }) },
  ),
);
