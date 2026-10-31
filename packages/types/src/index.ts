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

/** Methods a store can accept today. */
export type PaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'BENEFIT_PAY' | 'TAP_PAY' | 'PAYPAL';

/** Methods an existing order may carry, including ones retired from the catalog. */
export type OrderPaymentMethod = PaymentMethod | 'CARD' | 'BENEFIT';

export type StorePaymentMethod = {
  code: PaymentMethod;
  name: LocalizedText;
};

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

export type MerchantChannelSales = {
  fulfillment: FulfillmentType;
  amount: MoneyString;
  change: string | null;
};

export type MerchantSalesPoint = { at: string; amount: MoneyString };

export type MerchantDashboard = {
  ordersToday: number;
  pendingOrders: number;
  preparingOrders: number;
  revenueToday: MoneyString;
  cashCollections: MoneyString;
  settlementBalance: MoneyString;
  topProducts: { id: string; name: LocalizedText; quantity: number; orders: number; revenue: MoneyString; imageUrl: string | null }[];
  lowStock: { id: string; name: LocalizedText; quantity: number }[];
  subscriptionUsage: EntitlementUsage[];
  feedbackAverage: string;
  feedbackCount: number;
  merchantName: LocalizedText;
  slug: string;
  acceptingOrders: boolean;
  preparationTargetMinutes: number;
  branches: { id: string; name: LocalizedText; city: string }[];
  ordersChange: string | null;
  salesChange: string | null;
  netSales: MoneyString;
  activeOrders: number;
  attentionOrders: number;
  averagePreparationMinutes: number | null;
  liveOrders: {
    id: string;
    number: string;
    customerName: string;
    tableNumber: string | null;
    fulfillmentType: FulfillmentType;
    amount: MoneyString;
    status: OrderStatus;
    createdAt: string;
    preparationMinutes: number | null;
  }[];
  drivers: { id: string; name: string }[];
  sales: { today: MerchantSalesPoint[]; week: MerchantSalesPoint[]; month: MerchantSalesPoint[] };
  channels: { today: MerchantChannelSales[]; week: MerchantChannelSales[]; month: MerchantChannelSales[] };
  delivery: {
    onTimeRate: string | null;
    onTimeChange: string | null;
    averageDistanceKm: string | null;
    distanceChange: string | null;
    driversOnline: number;
    driversAssigned: number;
  };
  plan: {
    name: LocalizedText | null;
    products: { used: number; limit: number | null };
    orders: { used: number; limit: number | null };
    staff: { used: number; limit: number | null };
  };
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
  /** True when the list was filtered and sorted for a customer location. */
  located?: boolean;
  openMerchants?: MerchantCard[];
  closedMerchants?: MerchantCard[];
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
  temporarilyUnavailable: boolean;
  visibility: VisibilityMode;
  fulfillment: FulfillmentType[];
  categories: LocalizedText[];
  categorySlugs: string[];
  city: string | null;
  freeDelivery: boolean;
  latitude: number | null;
  longitude: number | null;
  /** Branch that serves the customer's location, when one was given. */
  branchId?: string | null;
  distanceKm?: string | null;
  deliveryAvailable?: boolean;
  deliveryUnavailableReason?: DeliveryUnavailableReason | null;
  freeDeliveryAbove?: MoneyString | null;
};

export type DeliveryUnavailableReason = 'DELIVERY_DISABLED' | 'OUT_OF_RANGE' | 'CONFIG_MISSING' | 'INVALID_COORDINATES' | 'BRANCH_INACTIVE';

export type DeliveryQuoteView = {
  branchId: string | null;
  branchName: string | null;
  available: boolean;
  reason: DeliveryUnavailableReason | null;
  distance: string | null;
  distanceUnit: 'km';
  estimatedMinutes: number;
  freeDelivery: boolean;
  freeReason: 'PROMOTION' | 'MINIMUM_ORDER' | 'WITHIN_FREE_RADIUS' | null;
  freeAboveOrder: MoneyString | null;
  deliveryCharge: MoneyString;
  tax: MoneyString;
  total: MoneyString;
  currency: 'BHD';
  summary: {
    method: 'ROAD' | 'HAVERSINE';
    freeRadiusKm: string;
    maxRadiusKm: string;
    chargeableKm: string;
    billingStepKm: string;
    billingUnits: number;
    ratePerStep: MoneyString;
    baseCharge: MoneyString;
    minCharge: MoneyString | null;
    maxCharge: MoneyString | null;
    standardCharge: MoneyString;
    taxRate: string;
    source: 'ZONE' | 'BRANCH' | 'MERCHANT' | 'LEGACY_MERCHANT' | 'PLATFORM_DEFAULT';
    version: number;
    configUpdatedAt: string | null;
  } | null;
};

export type CustomerAddress = {
  id: string;
  label: string;
  line1: string;
  line2: string | null;
  city: string;
  latitude: string;
  longitude: string;
  building: string | null;
  flat: string | null;
  road: string | null;
  block: string | null;
  area: string | null;
  landmark: string | null;
  contactName: string | null;
  contactPhone: string | null;
  instructions: string | null;
  isDefault: boolean;
};

export type ReverseGeocodeView = {
  latitude: string;
  longitude: string;
  insideServiceCountry: boolean;
  resolved: boolean;
  label: string | null;
  road: string | null;
  block: string | null;
  area: string | null;
  city: string | null;
};

export type NearestAddressView = {
  maxDistanceKm: string;
  address: CustomerAddress | null;
  distanceKm: string | null;
  closestDistanceKm: string | null;
  savedCount: number;
};

export type CheckoutProblemCode =
  | 'AUTH_REQUIRED'
  | 'CART_EMPTY'
  | 'CART_CHANGED'
  | 'STORE_UNAVAILABLE'
  | 'MERCHANT_CLOSED'
  | 'PRODUCT_UNAVAILABLE'
  | 'ADDRESS_REQUIRED'
  | 'ADDRESS_INVALID'
  | 'ADDRESS_OUT_OF_RANGE'
  | 'DELIVERY_DISABLED'
  | 'DELIVERY_CONFIG_MISSING'
  | 'DELIVERY_QUOTE_FAILED'
  | 'FULFILLMENT_UNAVAILABLE'
  | 'PAYMENT_METHOD_UNAVAILABLE'
  | 'PROMO_INVALID'
  | 'TOTAL_CHANGED';

export type CheckoutSummary = {
  cartVersion: string;
  merchant: MerchantCard | null;
  branch: { id: string; name: LocalizedText; address: string; latitude: string; longitude: string } | null;
  fulfillmentType: FulfillmentType;
  address: CustomerAddress | null;
  delivery: DeliveryQuoteView | null;
  items: Pick<CartLine, 'id' | 'productId' | 'name' | 'variantName' | 'quantity' | 'unitPrice' | 'lineTotal' | 'addons' | 'notes' | 'imageUrl'>[];
  pricing: PriceBreakdown | null;
  paymentMethods: StorePaymentMethod[];
  problems: { code: CheckoutProblemCode; message: string }[];
  canPlace: boolean;
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
  temporarilyUnavailable?: boolean;
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
  serviceFee: MoneyString;
  serviceFeeLabel?: LocalizedText;
  deliveryTax?: MoneyString;
  tax: MoneyString;
  taxLabel?: LocalizedText;
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
  paymentMethods: StorePaymentMethod[];
  /** Delivery quote for the cart's location; null before a location is known or when not delivering. */
  delivery?: DeliveryQuoteView | null;
  /** Changes when lines change; checkout sends it back to detect edits from another tab. */
  version?: string;
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
  paymentMethod: OrderPaymentMethod | null;
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

export type RiderProfile = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  vehicle: string | null;
  onShift: boolean;
  shiftStartedAt: string | null;
  store: { name: LocalizedText; logoUrl: string | null; phone: string | null } | null;
  deliveredToday: number;
  activeOrders: number;
};

export type DeliveryIssueType = 'CUSTOMER_UNREACHABLE' | 'WRONG_ADDRESS' | 'ITEM_MISSING' | 'DAMAGED' | 'PAYMENT_REFUSED' | 'OTHER';

export type RiderOrder = {
  id: string;
  number: string;
  status: OrderStatus;
  stop: number | null;
  /** Drive from the previous stop (or the route start) to this one, and minutes until arrival along the route. */
  legKm: number | null;
  etaMinutes: number | null;
  sequence: number;
  createdAt: string;
  scheduledFor: string | null;
  assignedAt: string | null;
  pickupVerifiedAt: string | null;
  pickupMethod: 'QR' | 'CODE' | null;
  /** The code printed on the ticket, so the rider can match tickets to orders at the counter. */
  pickupCode: string | null;
  notes: string | null;
  customer: { name: string; phone: string | null };
  address: {
    label: string | null;
    line1: string | null;
    line2: string | null;
    city: string | null;
    building: string | null;
    flat: string | null;
    road: string | null;
    block: string | null;
    area: string | null;
    landmark: string | null;
    instructions: string | null;
    latitude: number | null;
    longitude: number | null;
    pinCorrectedAt: string | null;
  };
  store: { name: LocalizedText; branch: LocalizedText; line1: string; city: string; phone: string | null; latitude: number; longitude: number };
  distanceKm: number | null;
  fromHereKm: number | null;
  items: { name: LocalizedText; quantity: number; lineTotal: MoneyString; notes: string | null; addons: { name: LocalizedText; quantity: number }[] }[];
  total: MoneyString;
  deliveryFee: MoneyString;
  paymentMethod: string | null;
  paid: boolean;
  cashDue: MoneyString | null;
  cashCollected: MoneyString | null;
  issues: { id: string; type: DeliveryIssueType; note: string | null; status: string; createdAt: string }[];
  events: { status: OrderStatus; note: string | null; createdAt: string }[];
};

export type RiderOrders = {
  origin: { latitude: number; longitude: number } | null;
  /** Where today's route starts: the store while orders are still to collect, else the rider's position. */
  route: { start: 'store' | 'rider'; toCollect: number; totalKm: number; etaMinutes: number } | null;
  active: RiderOrder[];
  delivered: RiderOrder[];
};

export type CashDepositStatus = 'SUBMITTED' | 'CONFIRMED' | 'REJECTED';

export type CashDepositView = {
  id: string;
  amount: MoneyString;
  status: CashDepositStatus;
  note: string | null;
  reviewNote: string | null;
  orders: number;
  createdAt: string;
  reviewedAt: string | null;
};

export type RiderCollections = {
  cashInHand: MoneyString;
  pendingDeposit: MoneyString;
  collectedToday: MoneyString;
  deliveredToday: number;
  inHand: { id: string; orderId: string; orderNumber: string; amount: MoneyString; collectedAt: string | null }[];
  transactions: {
    orderId: string;
    orderNumber: string;
    total: MoneyString;
    method: string | null;
    collected: MoneyString | null;
    cashStatus: 'PENDING' | 'COLLECTED' | 'CONFIRMED' | 'DISPUTED' | 'DEPOSIT_PENDING' | null;
    deliveredAt: string;
  }[];
  deposits: CashDepositView[];
};

export type StoreCashDeposits = {
  deposits: (Omit<CashDepositView, 'orders'> & {
    rider: { id: string; name: string; phone: string | null };
    orders: { number: string; amount: MoneyString }[];
  })[];
  inHand: { riderId: string; name: string; amount: MoneyString }[];
};

export type PickupHandoff = { orderId: string; number: string; code: string; qr: string };

export type DispatchReason =
  | { code: 'WAITING'; minutes: number }
  | { code: 'LATE'; minutes: number }
  | { code: 'HOT' }
  | { code: 'DUE_SOON'; minutes: number }
  | { code: 'SCHEDULED_LATER'; minutes: number }
  | { code: 'FAR'; km: number }
  | { code: 'NO_PIN' };

export type DispatchOrder = {
  id: string;
  number: string;
  status: OrderStatus;
  ready: boolean;
  customerName: string;
  address: { line1: string | null; area: string | null };
  latitude: number | null;
  longitude: number | null;
  distanceKm: number | null;
  items: number;
  total: MoneyString;
  cash: boolean;
  hot: boolean;
  createdAt: string;
  readyAt: string | null;
  estimatedReadyAt: string | null;
  scheduledFor: string | null;
  score: number;
  reasons: DispatchReason[];
};

export type DispatchRider = {
  id: string;
  name: string;
  phone: string | null;
  vehicle: string | null;
  onShift: boolean;
  lastLatitude: number | null;
  lastLongitude: number | null;
  lastSeenAt: string | null;
  active: { orderId: string; number: string; status: OrderStatus; sequence: number; pickedUp: boolean; assignedAt: string; latitude: number | null; longitude: number | null }[];
};

export type DispatchBoard = {
  branch: { id: string; name: LocalizedText; line1: string; latitude: number; longitude: number };
  branches: { id: string; name: LocalizedText }[];
  ready: DispatchOrder[];
  upcoming: DispatchOrder[];
  riders: DispatchRider[];
  generatedAt: string;
};

export type DispatchPlanResult = {
  routes: { riderId: string; stops: { orderId: string; legKm: number | null; cumulativeKm: number | null }[]; totalKm: number; etaMinutes: number }[];
  leftover: string[];
  board: DispatchBoard;
};

export type KitchenTicket = {
  id: string;
  number: string;
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  tableNumber: string | null;
  customerName: string;
  notes: string | null;
  createdAt: string;
  acceptedAt: string | null;
  startedAt: string | null;
  readyAt: string | null;
  scheduledFor: string | null;
  preparationMinutes: number | null;
  estimatedReadyAt: string | null;
  items: { id: string; name: LocalizedText; quantity: number; notes: string | null; addons: LocalizedText[] }[];
};

export type KitchenBoard = { tickets: KitchenTicket[]; generatedAt: string };

export type ServiceRequestKind = 'WAITER' | 'BILL' | 'HELP';
export type ServiceRequestStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export type ServiceRequestView = {
  id: string;
  kind: ServiceRequestKind;
  status: ServiceRequestStatus;
  table: { id: string; number: string; name: string };
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
};

export type TableLayout = {
  positions: Record<string, { x: number; y: number }>;
  zones: {
    order: string[];
    widths: Record<string, number>;
    heights: Record<string, number>;
    rects: Record<string, { x: number; y: number; width: number; height: number }>;
  };
};

export type FloorOrder = {
  id: string;
  number: string;
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  total: MoneyString;
  createdAt: string;
  estimatedReadyAt: string | null;
  readyAt: string | null;
  tableId: string | null;
  tableNumber: string | null;
  customerName: string;
  notes: string | null;
  takenByMe: boolean;
  items: { name: LocalizedText; quantity: number; notes: string | null; addons: LocalizedText[] }[];
};

export type FloorTable = {
  id: string;
  number: string;
  name: string;
  capacity: number;
  status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'INACTIVE';
  branchId: string | null;
  floor: { id: string; name: LocalizedText };
  openedAt: string | null;
};

/** Everything the order taker app shows live: tables, calls and the orders still in progress. */
export type FloorBoard = {
  layout: TableLayout | null;
  tables: FloorTable[];
  requests: ServiceRequestView[];
  orders: FloorOrder[];
  servedToday: number;
  generatedAt: string;
};

export type FloorMenuProduct = {
  id: string;
  name: LocalizedText;
  description: LocalizedText;
  price: MoneyString;
  imageUrl: string | null;
  available: boolean;
  variants: { id: string; name: LocalizedText; price: MoneyString; available: boolean }[];
  addonGroups: { id: string; name: LocalizedText; minSelect: number; maxSelect: number; addons: { id: string; name: LocalizedText; price: MoneyString; available: boolean }[] }[];
};

export type FloorMenu = { categories: { id: string; name: LocalizedText; products: FloorMenuProduct[] }[] };

/** The diner's table, from the QR they scanned, and any call still open there. */
export type TableServiceView = {
  table: { id: string; number: string; name: string };
  requests: ServiceRequestView[];
  /** What the table has ordered so far and what is still to pay, or the bill just paid. */
  bill: DinerBill | null;
};

export type DinerBill = {
  orders: { number: string; status: OrderStatus; paid: boolean; total: MoneyString; items: { name: LocalizedText; quantity: number; total: MoneyString }[] }[];
  subtotal: MoneyString;
  discount: MoneyString;
  serviceFee: MoneyString;
  tax: MoneyString;
  total: MoneyString;
  paid: MoneyString;
  due: MoneyString;
  /** Set once the table has paid at the till. */
  settled: { number: string; method: BillMethod; settledAt: string } | null;
};

/** How a bill was paid at the till; ONLINE when every order on it was paid in the app. */
export type BillMethod = 'CASH' | 'CARD' | 'BENEFIT_PAY' | 'ONLINE';

export type BillLine = { name: LocalizedText; quantity: number; unitPrice: MoneyString; total: MoneyString; addons: LocalizedText[]; notes: string | null };

export type BillOrder = {
  id: string;
  number: string;
  status: OrderStatus;
  fulfillmentType: FulfillmentType;
  createdAt: string;
  /** Paid before the till, in the app. */
  paid: boolean;
  method: string | null;
  subtotal: MoneyString;
  discount: MoneyString;
  serviceFee: MoneyString;
  tax: MoneyString;
  total: MoneyString;
  items: BillLine[];
};

type BillTotals = { subtotal: MoneyString; discount: MoneyString; serviceFee: MoneyString; tax: MoneyString; total: MoneyString };

/** A table, or a counter order, still to pay. */
export type OpenBill = BillTotals & {
  key: string;
  kind: 'TABLE' | 'COUNTER';
  table: { id: string; number: string; name: string } | null;
  customerName: string | null;
  orders: BillOrder[];
  openedAt: string;
  prepaid: MoneyString;
  due: MoneyString;
  /** Every order has reached the guest. */
  served: boolean;
  /** The table pressed "Bring the bill". */
  requested: boolean;
};

export type PaidBill = BillTotals & {
  id: string;
  number: string;
  kind: 'TABLE' | 'COUNTER';
  table: { id: string; number: string; name: string } | null;
  method: BillMethod;
  prepaid: MoneyString;
  collected: MoneyString;
  tendered: MoneyString | null;
  change: MoneyString | null;
  settledAt: string;
  settledBy: string | null;
  orders: BillOrder[];
};

export type CashDrawerView = {
  id: string;
  openedAt: string;
  openedBy: string | null;
  openingFloat: MoneyString;
  /** Cash bills taken into this drawer, net of change. */
  cashSales: MoneyString;
  bills: number;
  expected: MoneyString;
  closedAt: string | null;
  closedBy: string | null;
  countedAmount: MoneyString | null;
  /** Counted less expected: negative is short. */
  difference: MoneyString | null;
  note: string | null;
};

export type BillingBoard = {
  open: OpenBill[];
  paid: PaidBill[];
  requests: ServiceRequestView[];
  drawer: CashDrawerView | null;
  today: {
    bills: number;
    collected: MoneyString;
    byMethod: { method: BillMethod; bills: number; amount: MoneyString }[];
    due: MoneyString;
  };
  generatedAt: string;
};

/** Payment method on an order, or UNPAID when no payment was recorded. */
export type TakingsMethod = OrderPaymentMethod | 'UNPAID';

export type StoreTakings = {
  date: string;
  orders: { total: number; completed: number; open: number; cancelled: number };
  gross: MoneyString;
  completedSales: MoneyString;
  discounts: MoneyString;
  deliveryFees: MoneyString;
  tax: MoneyString;
  averageOrder: MoneyString;
  byMethod: { method: TakingsMethod; orders: number; amount: MoneyString; paid: MoneyString; due: MoneyString }[];
  byHour: { hour: number; orders: number; amount: MoneyString }[];
  refunds: { count: number; requested: MoneyString; processed: MoneyString };
  cash: { withRiders: MoneyString; awaitingConfirmation: MoneyString; depositsToReview: number; confirmed: MoneyString };
};

export type StoreReport = {
  from: string;
  to: string;
  summary: {
    orders: number;
    completed: number;
    cancelled: number;
    cancellationRate: number;
    sales: MoneyString;
    averageOrder: MoneyString;
    discounts: MoneyString;
    deliveryFees: MoneyString;
    refunds: MoneyString;
    customers: number;
    repeatCustomers: number;
    prepMinutes: number | null;
    deliveryMinutes: number | null;
    fulfilmentMinutes: number | null;
  };
  daily: { date: string; orders: number; sales: MoneyString }[];
  byChannel: { type: FulfillmentType; orders: number; sales: MoneyString }[];
  byPayment: { method: TakingsMethod; orders: number; sales: MoneyString }[];
  byHour: { hour: number; orders: number }[];
  topProducts: { name: LocalizedText; quantity: number; sales: MoneyString }[];
};
