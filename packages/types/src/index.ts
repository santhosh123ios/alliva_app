export type Locale = 'en' | 'ar';

export type LocalizedText = { en: string; ar: string };

export type MoneyString = string;

export type UserKind = 'STAFF' | 'MERCHANT_USER' | 'CUSTOMER';

export type AccountStatus = 'PENDING_ACTIVATION' | 'ACTIVE' | 'SUSPENDED';

export type OrderStatus =
  | 'PENDING'
  | 'ACCEPTED'
  | 'PREPARING'
  | 'READY_FOR_PICKUP'
  | 'ASSIGNED_TO_DRIVER'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED';

export type FulfillmentType = 'DELIVERY' | 'TAKEAWAY' | 'DINE_IN';

export type VisibilityMode = 'ALL_STORES' | 'EXCLUDE_SAME_BUSINESS_TYPE' | 'CURRENT_STORE_ONLY' | 'MARKETPLACE' | 'EXCLUSIVE_STOREFRONT';

export type PaymentMethod = 'CARD' | 'BENEFIT' | 'BENEFIT_PAY' | 'CASH';

export const ORDER_STATUSES: OrderStatus[] = [
  'PENDING',
  'ACCEPTED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'ASSIGNED_TO_DRIVER',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
];

export const ENTITLEMENT_KEYS = [
  'visibility',
  'monthlyOrderLimit',
  'productLimit',
  'branchLimit',
  'staffLimit',
  'offerHighlighting',
  'bannerAdvertising',
  'paymentIntegration',
  'tableOrdering',
  'tableCountLimit',
  'reporting',
  'merchantCommissionPercent',
  'billingIntervals',
  'deliveryOrdering',
  'takeawayOrdering',
  'merchantPromoCodes',
  'transactionalNotifications',
  'promotionalNotifications',
  'supportLevel',
] as const;

export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[number];

export type PageMeta = { page: number; pageSize: number; total: number };

export type Page<T> = { data: T[]; meta: PageMeta };

export type AuthUser = {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  kind: UserKind;
  status: AccountStatus;
  merchantId: string | null;
  locale: Locale;
  permissions: string[];
  roles: string[];
  twoFactorEnabled: boolean;
};

export type LoginResult =
  | { requiresTwoFactor: true; challengeId: string }
  | { user: AuthUser; csrfToken: string };

export type AdminDashboard = {
  totalMerchants: number;
  activeSubscriptions: number;
  totalCustomers: number;
  ordersToday: number;
  grossOrderValue: MoneyString;
  platformRevenue: MoneyString;
  monthRevenue: MoneyString;
  revenueChange: string | null;
  ordersChange: string | null;
  revenueSeries: { date: string; amount: MoneyString }[];
  ordersInMotion: {
    id: string;
    number: string;
    merchantName: LocalizedText;
    amount: MoneyString;
    status: OrderStatus;
    createdAt: string;
  }[];
  merchantHealth: { online: number; offline: number; paused: number };
  pendingSettlements: MoneyString;
  marketingCommissions: MoneyString;
  subscriptionsExpiringSoon: number;
  pendingApprovals: number;
  complaintsRequiringAction: number;
  refundSummary: { pending: number; approvedAmount: MoneyString };
  deliveryPerformance: { averageMinutes: number; onTimeRate: string };
  recentActivity: AuditItem[];
};

export type AuditItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  createdAt: string;
  actorName: string | null;
};

export type MerchantDashboard = {
  ordersToday: number;
  pendingOrders: number;
  preparingOrders: number;
  revenueToday: MoneyString;
  cashCollections: MoneyString;
  settlementBalance: MoneyString;
  topProducts: { id: string; name: LocalizedText; quantity: number }[];
  lowStock: { id: string; name: LocalizedText; quantity: number }[];
  subscriptionUsage: EntitlementUsage[];
  feedbackAverage: string;
  feedbackCount: number;
};

export type EntitlementUsage = {
  key: string;
  value: unknown;
  usage: number | null;
};

export type StorefrontHome = {
  exclusiveMerchant: MerchantCard | null;
  categories: { id: string; name: LocalizedText; slug: string }[];
  merchants: MerchantCard[];
  featured: MerchantCard[];
  offers: OfferCard[];
  banners: BannerCard[];
  topProducts: ProductCard[];
  recommended: ProductCard[];
  recentlyViewed: ProductCard[];
  freeDelivery: MerchantCard[];
};

export type MerchantCard = {
  id: string;
  slug: string;
  name: LocalizedText;
  description: LocalizedText;
  logoUrl: string | null;
  coverUrl: string | null;
  rating: string;
  reviewCount: number;
  deliveryMinutes: number;
  deliveryFee: MoneyString;
  minimumOrder: MoneyString;
  isOpen: boolean;
  visibility: VisibilityMode;
  fulfillment: FulfillmentType[];
  categories: LocalizedText[];
  categorySlugs: string[];
  city: string | null;
  freeDelivery: boolean;
  latitude: number | null;
  longitude: number | null;
};

export type OfferCard = {
  id: string;
  title: LocalizedText;
  merchantSlug: string;
  merchantName: LocalizedText;
};

export type BannerCard = {
  id: string;
  title: LocalizedText;
  imageUrl: string | null;
  merchantSlug: string | null;
};

export type ProductCard = {
  id: string;
  merchantId: string;
  merchantSlug: string;
  merchantName: LocalizedText;
  name: LocalizedText;
  description: LocalizedText;
  imageUrl: string | null;
  price: MoneyString;
  compareAtPrice: MoneyString | null;
  rating: string;
  reviewCount: number;
  available: boolean;
  customizable: boolean;
};

export type ProductDetail = ProductCard & {
  images: string[];
  variants: {
    id: string;
    name: LocalizedText;
    price: MoneyString;
    available: boolean;
  }[];
  addonGroups: {
    id: string;
    name: LocalizedText;
    minSelect: number;
    maxSelect: number;
    addons: { id: string; name: LocalizedText; price: MoneyString }[];
  }[];
};

export type MerchantStorefront = Omit<MerchantCard, 'categories' | 'latitude' | 'longitude'> & {
  address: string;
  latitude: string;
  longitude: string;
  businessCategories: LocalizedText[];
  preparationMinutes: number;
  hours: { dayOfWeek: number; opensAt: string; closesAt: string; closed: boolean }[];
  categories: { id: string; name: LocalizedText; products: ProductCard[] }[];
  reviews: { id: string; rating: number; comment: string | null; author: string; createdAt: string }[];
  offers: { id: string; title: LocalizedText }[];
};

export type CartLine = {
  id: string;
  productId: string;
  variantId: string | null;
  name: LocalizedText;
  description: LocalizedText;
  imageUrl: string | null;
  variantName: LocalizedText | null;
  variants: { id: string; name: LocalizedText }[];
  customizable: boolean;
  quantity: number;
  unitPrice: MoneyString;
  lineTotal: MoneyString;
  addons: { id: string; name: LocalizedText; price: MoneyString }[];
  notes: string | null;
};

export type PriceBreakdown = {
  subtotal: MoneyString;
  discount: MoneyString;
  deliveryFee: MoneyString;
  deliveryFeeSaved: MoneyString;
  tax: MoneyString;
  total: MoneyString;
  currency: 'BHD';
  promoCode: string | null;
};

export type CartView = {
  id: string;
  merchant: MerchantCard | null;
  fulfillmentType: FulfillmentType | null;
  items: CartLine[];
  pricing: PriceBreakdown;
  notes: string | null;
  scheduledFor: string | null;
  addressId: string | null;
  tableId: string | null;
};

export type OrderView = {
  id: string;
  number: string;
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  merchantName: LocalizedText;
  merchantSlug: string;
  merchantPhone: string | null;
  merchantLogoUrl: string | null;
  merchantCoverUrl: string | null;
  driverName: string | null;
  driverPhone: string | null;
  driverVehicle: string | null;
  items: { name: LocalizedText; quantity: number; lineTotal: MoneyString; imageUrl: string | null }[];
  pricing: PriceBreakdown;
  notes: string | null;
  cancellationReason: string | null;
  preparationMinutes: number | null;
  estimatedArrival: string | null;
  scheduledFor: string | null;
  distanceKm: string | null;
  createdAt: string;
  events: { status: OrderStatus; createdAt: string; note: string | null }[];
  customerName: string;
  tableNumber: string | null;
  address: string | null;
  paymentMethod: PaymentMethod | null;
};

export type SubscriptionPlanView = {
  id: string;
  code: string;
  name: LocalizedText;
  description: LocalizedText;
  priceMonthly: MoneyString;
  priceAnnual: MoneyString;
  status: string;
  displayOrder: number;
  recommended: boolean;
  entitlements: { key: string; value: unknown }[];
};

export type SubscriptionBoard = {
  activeSubscriptions: number;
  monthlyRecurringRevenue: MoneyString;
  expiringIn7Days: number;
  plans: (SubscriptionPlanView & { merchantCount: number })[];
  subscriptions: {
    id: string;
    merchantId: string;
    merchantName: LocalizedText;
    planId: string;
    planName: LocalizedText;
    status: string;
    billingInterval: 'MONTHLY' | 'ANNUAL';
    currentPeriodStart: string;
    currentPeriodEnd: string;
    amount: MoneyString;
    pendingPlanName: LocalizedText | null;
    pendingEffectiveAt: string | null;
    usage: { key: string; used: number; limit: number | null }[];
  }[];
};

export type ComplaintView = {
  id: string;
  source: string;
  category: string;
  priority: string;
  status: string;
  subject: string;
  description: string;
  orderId: string | null;
  assigneeName: string | null;
  createdAt: string;
  satisfaction: number | null;
};

export type LedgerView = {
  id: string;
  type: string;
  amount: MoneyString;
  currency: string;
  debitAccount: string;
  creditAccount: string;
  referenceType: string;
  referenceId: string;
  createdAt: string;
};

export type ReportOverview = {
  orders: number;
  revenue: MoneyString;
  merchantGrowth: number;
  subscriptionRevenue: MoneyString;
  customerAcquisition: number;
  repeatOrderRate: string;
  averageOrderValue: MoneyString;
  promoRedemptions: number;
  commissionTotal: MoneyString;
  averageDeliveryMinutes: number;
  cancellations: number;
  refunds: MoneyString;
  topProducts: { name: LocalizedText; quantity: number; revenue: MoneyString }[];
};
