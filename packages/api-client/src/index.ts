import type {
  AdminDashboard,
  KitchenBoard,
  StoreReport,
  StoreTakings,
  AuthUser,
  CartView,
  CheckoutSummary,
  CustomerAddress,
  DeliveryQuoteView,
  LoginResult,
  MerchantCard,
  NearestAddressView,
  ReverseGeocodeView,
  MerchantDashboard,
  MerchantStorefront,
  OrderView,
  PickupHandoff,
  RiderCollections,
  RiderOrder,
  RiderOrders,
  RiderProfile,
  CashDepositView,
  StoreCashDeposits,
  DispatchBoard,
  DispatchPlanResult,
  DeliveryIssueType,
  Page,
  ProductDetail,
  ReportOverview,
  StorefrontHome,
  SubscriptionBoard,
  StorePaymentMethod,
  SubscriptionPlanView,
} from '@alliva/types';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown> | unknown[] | string | number | boolean | null;

export type MerchantPromo = {
  id: string;
  code: string;
  description: { en: string; ar: string };
  discountType: 'FIXED' | 'PERCENTAGE';
  discountValue: string;
  minimumOrder: string | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  usedCount: number;
  startsAt: string;
  endsAt: string;
  firstOrderOnly: boolean;
  active: boolean;
};

export type SubscriptionQuote = {
  gross: string;
  discount: string;
  serviceFee: string;
  serviceFeeLabel: { en: string; ar: string };
  tax: string;
  taxLabel: { en: string; ar: string };
  payable: string;
  promo: { valid: true; code: string } | { valid: false; reason: string } | null;
  referral: { valid: true; code: string; staffName: string } | { valid: false; reason: string } | null;
};

export type PortalWallet = {
  available: string;
  pending: string;
  withdrawn: string;
  canWithdraw?: boolean;
  transactions: { id: string; createdAt: string; type: 'EARNED' | 'WITHDRAWAL' | 'REWARD'; amount: string }[];
  withdrawals: { id: string; createdAt: string; amount: string; status: string }[];
};

export type SubscriptionPaymentsView = {
  currentPeriodVerified: boolean;
  payments: {
    id: string;
    plan: { en: string; ar: string };
    gross: string;
    discount: string;
    amount: string;
    refunded: string;
    status: string;
    isRenewal: boolean;
    verifiedAt: string | null;
    createdAt: string;
    commission: string;
    refunds: { id: string; amount: string; reason: string; createdAt: string }[];
  }[];
};

function queryString(query?: Record<string, unknown>) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

export type AuthPortal = 'admin' | 'merchant' | 'customer' | 'marketing';

export function createApiClient(baseUrl = '', portal?: AuthPortal) {
  const csrfCookie = portal ? `alliva_csrf_${portal}` : 'alliva_csrf';

  function authHeaders(init?: HeadersInit) {
    const headers = new Headers(init);
    if (portal) headers.set('x-alliva-portal', portal);
    return headers;
  }

  function csrfToken() {
    if (typeof document === 'undefined') return;
    const match = document.cookie.match(new RegExp(`(?:^|; )${csrfCookie}=([^;]+)`));
    return match?.[1] ? decodeURIComponent(match[1]) : undefined;
  }

  async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const headers = authHeaders(init.headers);
    if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    if (init.method && init.method !== 'GET') {
      const token = csrfToken();
      if (token) headers.set('x-csrf-token', token);
    }
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers, credentials: 'include' });
    if (
      response.status === 401 &&
      retry &&
      !path.includes('/auth/login') &&
      !path.includes('/auth/refresh') &&
      !path.includes('/auth/firebase')
    ) {
      const refreshed = await fetch(`${baseUrl}/api/auth/refresh`, { method: 'POST', credentials: 'include', headers: authHeaders() });
      if (refreshed.ok) return request(path, init, false);
    }
    if (response.status === 204) return undefined as T;
    const data = (await response.json().catch(() => null)) as { message?: string; csrfToken?: string } | null;
    if (!response.ok) {
      const message = Array.isArray(data?.message) ? 'Check the form and try again' : data?.message ?? 'Request failed';
      throw new ApiError(response.status, message, data);
    }
    return data as T;
  }

  const send = <T>(path: string, method: string, body?: Json) =>
    request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

  /** A file download (CSV, PDF) as a Blob, with the same sign-in refresh as `request`. */
  async function file(path: string, retry = true): Promise<Blob> {
    const response = await fetch(`${baseUrl}${path}`, { headers: authHeaders(), credentials: 'include' });
    if (response.status === 401 && retry) {
      const refreshed = await fetch(`${baseUrl}/api/auth/refresh`, { method: 'POST', credentials: 'include', headers: authHeaders() });
      if (refreshed.ok) return file(path, false);
    }
    if (!response.ok) {
      const data = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new ApiError(response.status, data?.message ?? 'Download failed', data);
    }
    return response.blob();
  }

  const query = (params: Record<string, string | undefined>) => {
    const search = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1])));
    const text = search.toString();
    return text ? `?${text}` : '';
  };

  return {
    request,
    guest: () => send<{ id: string; csrfToken?: string }>('/api/guests', 'POST'),
    login: (body: { email: string; password: string; rememberDevice?: boolean }) =>
      send<LoginResult>('/api/auth/login', 'POST', body),
    registerCustomer: (body: { email: string; password: string; firstName: string; lastName: string; rememberDevice?: boolean }) =>
      send<LoginResult>('/api/auth/customer/register', 'POST', body),
    verifyTwoFactor: (body: { challengeId: string; code: string }) =>
      send<LoginResult>('/api/auth/2fa/verify', 'POST', body),
    logout: () => send('/api/auth/logout', 'POST'),
    me: () => request<AuthUser>('/api/auth/me'),
    forgot: (email: string) => send<{ ok: boolean; devResetToken?: string }>('/api/auth/forgot-password', 'POST', { email }),
    reset: (token: string, password: string) => send('/api/auth/reset-password', 'POST', { token, password }),
    requestOtp: (phone: string, locale?: 'en' | 'ar') =>
      send<{ ok: true; channel: 'whatsapp' | 'dev' }>('/api/auth/otp/request', 'POST', { phone, locale }),
    verifyOtp: (body: { phone: string; code: string; firstName?: string; lastName?: string }) =>
      send<LoginResult>('/api/auth/otp/verify', 'POST', body),
    firebaseAuth: () =>
      request<
        | { enabled: false }
        | { enabled: true; apiKey: string; authDomain: string; projectId: string; appId: string }
      >('/api/auth/firebase'),
    verifyFirebase: (body: { idToken: string; firstName?: string; lastName?: string }) =>
      send<LoginResult>('/api/auth/firebase', 'POST', body),
    socketToken: () => request<{ token: string }>('/api/auth/socket-token'),
    home: (query = '') => request<StorefrontHome>(`/api/storefront/home${query}`),
    merchant: (slug: string) => request<MerchantStorefront>(`/api/storefront/merchants/${slug}`),
    product: (id: string) => request<ProductDetail>(`/api/storefront/products/${id}`),
    cart: () => request<CartView>('/api/cart'),
    addItem: (body: Json) => send<CartView>('/api/cart/items', 'POST', body),
    updateItem: (id: string, quantity: number, variantId?: string | null) =>
      send<CartView>(`/api/cart/items/${id}`, 'PATCH', variantId === undefined ? { quantity } : { quantity, variantId }),
    removeItem: (id: string) => send<CartView>(`/api/cart/items/${id}`, 'DELETE'),
    cartContext: (body: Json) => send<CartView>('/api/cart/context', 'PUT', body),
    applyPromo: (code: string) => send<CartView>('/api/cart/promo', 'POST', { code }),
    checkout: (body: Json, idempotencyKey: string) =>
      request<OrderView>('/api/orders', { method: 'POST', body: JSON.stringify(body), headers: { 'idempotency-key': idempotencyKey } }),
    orders: () => request<OrderView[]>('/api/orders'),
    order: (id: string) => request<OrderView>(`/api/orders/${id}`),
    cancel: (id: string, reason: string) => send(`/api/orders/${id}/cancel`, 'POST', { reason }),
    review: (id: string, body: Json) => send(`/api/orders/${id}/review`, 'POST', body),
    reorder: (id: string) => send<CartView>(`/api/orders/${id}/reorder`, 'POST'),
    transition: (id: string, body: Json) => send<OrderView>(`/api/orders/${id}/transition`, 'POST', body),
    adminDashboard: () => request<AdminDashboard>('/api/admin/dashboard'),
    merchantDashboard: (branchId?: string) => request<MerchantDashboard>(`/api/merchant/dashboard${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ''}`),
    merchantWallet: () => request<PortalWallet>('/api/merchant/wallet'),
    requestMerchantWithdrawal: (amount: string) => send<{ id: string; amount: string; status: string }>('/api/merchant/wallet/withdrawals', 'POST', { amount }),
    merchants: () => request<Json[]>('/api/admin/merchants'),
    publicPlans: () => request<SubscriptionPlanView[]>('/api/public/plans'),
    publicPaymentMethods: () => request<StorePaymentMethod[]>('/api/public/payment-methods'),
    merchantEmailAvailability: (email: string) =>
      send<{ available: boolean }>('/api/public/merchant-email-availability', 'POST', { email }),
    registerMerchant: (body: Json) => send('/api/public/merchant-registration', 'POST', body),
    createMerchant: (body: Json) => send('/api/admin/merchants', 'POST', body),
    approveMerchant: (id: string, options?: { confirmPayment?: boolean }) => send(`/api/admin/merchants/${id}/approve`, 'POST', { confirmPayment: options?.confirmPayment === true }),
    suspendMerchant: (id: string) => send(`/api/admin/merchants/${id}/suspend`, 'POST'),
    businessCategories: () => request<{ id: string; slug: string; name: { en?: string; ar?: string } }[]>('/api/business-categories'),
    plans: () => request<SubscriptionPlanView[]>('/api/admin/plans'),
    subscriptionBoard: () => request<SubscriptionBoard>('/api/admin/subscriptions'),
    createPlan: (body: Json) => send('/api/admin/plans', 'POST', body),
    updatePlan: (id: string, body: Json) => send(`/api/admin/plans/${id}`, 'PATCH', body),
    duplicatePlan: (id: string) => send(`/api/admin/plans/${id}/duplicate`, 'POST'),
    reorderPlans: (ids: string[]) => send('/api/admin/plans/reorder', 'POST', { ids }),
    assignPlan: (merchantId: string, body: Json) => send(`/api/admin/merchants/${merchantId}/subscription`, 'POST', body),
    subscriptionHistory: (merchantId: string) => request<Json[]>(`/api/admin/merchants/${merchantId}/subscription/history`),
    rider: {
      me: () => request<RiderProfile>('/api/rider/me'),
      setShift: (body: { onShift: boolean; latitude?: number; longitude?: number }) => send<RiderProfile>('/api/rider/shift', 'POST', body),
      ping: (body: { latitude: number; longitude: number }) => send<{ ok: true }>('/api/rider/location', 'POST', body),
      orders: (from?: { latitude: number; longitude: number } | null) =>
        request<RiderOrders>(`/api/rider/orders${queryString(from ? { lat: from.latitude, lng: from.longitude } : undefined)}`),
      order: (id: string) => request<RiderOrder>(`/api/rider/orders/${id}`),
      verifyPickup: (body: { qr?: string; code?: string; orderId?: string }) => send<RiderOrder>('/api/rider/pickup', 'POST', body),
      setStatus: (id: string, body: { status: 'OUT_FOR_DELIVERY' | 'DELIVERED'; collectedAmount?: string; note?: string }) =>
        send<{ order: RiderOrder }>(`/api/rider/orders/${id}/status`, 'POST', body),
      correctDropoff: (id: string, body: { latitude: number; longitude: number; note?: string }) => send<RiderOrder>(`/api/rider/orders/${id}/dropoff`, 'POST', body),
      reportIssue: (id: string, body: { type: DeliveryIssueType; note?: string }) => send<RiderOrder>(`/api/rider/orders/${id}/issues`, 'POST', body),
      collections: () => request<RiderCollections>('/api/rider/collections'),
      deposit: (body: { collectionIds?: string[]; note?: string }) => send<CashDepositView>('/api/rider/deposits', 'POST', body),
    },
    dispatchBoard: (branchId?: string) => request<DispatchBoard>(`/api/merchant/dispatch/board${queryString({ branchId })}`),
    dispatchPlan: (body: { branchId?: string; riderIds: string[]; orderIds?: string[]; maxPerRider: number }) => send<DispatchPlanResult>('/api/merchant/dispatch/plan', 'POST', body),
    dispatchAssign: (body: { routes: { riderId: string; orderIds: string[] }[] }) => send<{ assigned: number }>('/api/merchant/dispatch/assign', 'POST', body),
    orderHandoff: (id: string) => request<PickupHandoff>(`/api/merchant/orders/${id}/handoff`),
    cashDeposits: () => request<StoreCashDeposits>('/api/merchant/cash-deposits'),
    kitchen: (branchId?: string) => request<KitchenBoard>(`/api/merchant/kitchen${query({ branchId })}`),
    takings: (params: { date?: string; branchId?: string } = {}) => request<StoreTakings>(`/api/merchant/takings${query(params)}`),
    storeReport: (params: { from?: string; to?: string; branchId?: string } = {}) => request<StoreReport>(`/api/merchant/reports${query(params)}`),
    storeReportFile: (kind: 'csv' | 'pdf', params: { from?: string; to?: string; branchId?: string } = {}) => file(`/api/merchant/reports/export.${kind}${query(params)}`),
    setTableStatus: (id: string, status: 'AVAILABLE' | 'OCCUPIED' | 'RESERVED' | 'INACTIVE') => send(`/api/merchant/tables/${id}/status`, 'POST', { status }),
    decideCashDeposit: (id: string, body: { decision: 'CONFIRMED' | 'REJECTED'; note?: string }) =>
      send<StoreCashDeposits>(`/api/merchant/cash-deposits/${id}/decision`, 'POST', body),
    staff: () => request<Json[]>('/api/staff'),
    createStaff: (body: Json) => send('/api/staff', 'POST', body),
    suspendStaff: (id: string) => send(`/api/staff/${id}/suspend`, 'POST'),
    activateStaff: (id: string) => send(`/api/staff/${id}/activate`, 'POST'),
    roles: () => request<{ id: string; key: string; name: { en?: string; ar?: string } }[]>('/api/roles'),
    complaints: () => request<Json[]>('/api/complaints'),
    updateComplaint: (id: string, body: Json) => send(`/api/complaints/${id}`, 'PATCH', body),
    payments: () => request<Json[]>('/api/finance/payments'),
    ledger: () => request<Json[]>('/api/finance/ledger'),
    settlements: () => request<Json[]>('/api/finance/settlements'),
    decideSettlement: (id: string, decision: 'APPROVED' | 'REJECTED') =>
      send(`/api/finance/settlements/${id}/decision`, 'POST', { decision }),
    merchantPromos: () => request<MerchantPromo[]>('/api/promos'),
    createMerchantPromo: (body: {
      code: string;
      description: string;
      descriptionAr?: string;
      discountType: 'FIXED' | 'PERCENTAGE';
      discountValue: string;
      minimumOrder?: string | null;
      usageLimit?: number | null;
      perCustomerLimit?: number | null;
      startsAt: string;
      endsAt: string;
      firstOrderOnly?: boolean;
    }) => send<MerchantPromo>('/api/promos', 'POST', body as Json),
    setMerchantPromoActive: (id: string, active: boolean) => send<MerchantPromo>(`/api/promos/${id}/active`, 'POST', { active }),
    quoteSubscription: (body: { planId: string; billingInterval: 'MONTHLY' | 'ANNUAL'; promoCode?: string; referralCode?: string }) =>
      send<SubscriptionQuote>('/api/public/subscription-quote', 'POST', body),
    validateReferral: (code: string) =>
      request<{ valid: true; code: string; staffName: string } | { valid: false; reason: string }>(`/api/marketing/referral/validate?code=${encodeURIComponent(code)}`),
    subscriptionPayments: (merchantId: string) => request<SubscriptionPaymentsView>(`/api/admin/merchants/${merchantId}/subscription/payments`),
    verifySubscriptionPayment: (merchantId: string) => send(`/api/admin/merchants/${merchantId}/subscription/verify-payment`, 'POST'),
    refundSubscriptionPayment: (paymentId: string, body: { amount?: string; reason: string; cancelSubscription?: boolean }) =>
      send(`/api/admin/subscription-payments/${paymentId}/refund`, 'POST', body),
    /** Marketing module: a thin typed wrapper over /api/marketing (lists are paginated, filters go in `query`). */
    mk: {
      get: <T = Json>(path: string, query?: Record<string, unknown>) => request<T>(`/api/marketing${path}${queryString(query)}`),
      post: <T = Json>(path: string, body: Json = {}) => send<T>(`/api/marketing${path}`, 'POST', body),
      patch: <T = Json>(path: string, body: Json = {}) => send<T>(`/api/marketing${path}`, 'PATCH', body),
      download: async (path: string, query: Record<string, unknown> | undefined, fallbackName: string) => {
        const response = await fetch(`${baseUrl}/api/marketing${path}${queryString(query)}`, { credentials: 'include', headers: authHeaders() });
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { message?: string } | null;
          throw new ApiError(response.status, data?.message ?? 'Download failed', data);
        }
        const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.click();
        URL.revokeObjectURL(url);
      },
    },
    report: () => request<ReportOverview>('/api/reports/overview'),
    settings: () => request<Json>('/api/settings'),
    updateSettings: (values: Json) => send('/api/settings', 'PATCH', { values }),
    audit: () => request<Json[]>('/api/audit'),
    live: () => request<OrderView[]>('/api/operations/live'),
    drivers: () => request<Json[]>('/api/operations/drivers'),
    dispatch: (orderId: string, driverId: string) => send('/api/operations/dispatch', 'POST', { orderId, driverId }),
    incidents: () => request<Json[]>('/api/operations/incidents'),
    createIncident: (body: Json) => send('/api/operations/incidents', 'POST', body),
    shifts: () => request<Json[]>('/api/operations/shifts'),
    createShift: (note: string) => send('/api/operations/shifts', 'POST', { note }),
    products: () => request<Json[]>('/api/catalog/products'),
    productOptions: (query: string) => request<Json[]>(`/api/catalog/product-options?q=${encodeURIComponent(query)}`),
    createProduct: (body: Json) => send('/api/catalog/products', 'POST', body),
    updateProduct: (id: string, body: Json) => send(`/api/catalog/products/${id}`, 'PATCH', body),
    importProducts: (rows: object[]) =>
      send<{ created: number; updated: number; errors: { row: number; message: string }[] }>('/api/catalog/products/import', 'POST', { rows } as Json),
    exportProducts: async () => {
      const load = () => fetch(`${baseUrl}/api/catalog/products/export`, { credentials: 'include', headers: authHeaders() });
      let response = await load();
      if (response.status === 401) {
        const refreshed = await fetch(`${baseUrl}/api/auth/refresh`, { method: 'POST', credentials: 'include', headers: authHeaders() });
        if (refreshed.ok) response = await load();
      }
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new ApiError(response.status, data?.message ?? 'Download failed', data);
      }
      return response.text();
    },
    createCategory: (body: Json) => send('/api/catalog/categories', 'POST', body),
    updateCategory: (id: string, body: Json) => send(`/api/catalog/categories/${id}`, 'PATCH', body),
    deleteCategory: (id: string) => send(`/api/catalog/categories/${id}`, 'DELETE'),
    categories: () => request<Json[]>('/api/catalog/categories'),
    categoryOptions: (query: string) => request<Json[]>(`/api/catalog/category-options?q=${encodeURIComponent(query)}`),
    adminCatalogCategories: () => request<Json[]>('/api/admin/catalog/categories'),
    updateAdminCatalogCategory: (id: string, body: Json) => send(`/api/admin/catalog/categories/${id}`, 'PATCH', body),
    mergeAdminCatalogCategory: (id: string, body: Json) => send(`/api/admin/catalog/categories/${id}/merge`, 'POST', body),
    adminCatalogProducts: () => request<Json[]>('/api/admin/catalog/products'),
    updateAdminCatalogProduct: (id: string, body: Json) => send(`/api/admin/catalog/products/${id}`, 'PATCH', body),
    mergeAdminCatalogProduct: (id: string, body: Json) => send(`/api/admin/catalog/products/${id}/merge`, 'POST', body),
    createOffer: (body: Json) => send('/api/catalog/offers', 'POST', body),
    profile: () => request<Json>('/api/merchant/profile'),
    updateProfile: (body: Json) => send('/api/merchant/profile', 'PATCH', body),
    completeBusinessSetup: (body: Json) => send('/api/merchant/business-setup', 'POST', body),
    upload: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return request<{ url: string }>('/api/uploads', { method: 'POST', body });
    },
    setHours: (hours: Json) => send('/api/merchant/hours', 'POST', { hours }),
    createBranch: (body: Json) => send('/api/merchant/branches', 'POST', body),
    updateBranch: (id: string, body: Json) => send(`/api/merchant/branches/${id}`, 'PATCH', body),
    closeStore: (body: Json) => send('/api/merchant/closures', 'POST', body),
    deliverySettings: <T>() => request<T>('/api/merchant/delivery-settings'),
    createDeliverySetting: <T>(body: Json) => send<T>('/api/merchant/delivery-settings', 'POST', body),
    updateDeliverySetting: <T>(id: string, body: Json) => send<T>(`/api/merchant/delivery-settings/${id}`, 'PATCH', body),
    deactivateDeliverySetting: (id: string) => send(`/api/merchant/delivery-settings/${id}`, 'DELETE'),
    previewDeliverySetting: <T>(body: Json) => send<T>('/api/merchant/delivery-settings/preview', 'POST', body),
    tables: () => request<Json[]>('/api/merchant/tables'),
    createFloor: (body: Json) => send('/api/merchant/floors', 'POST', body),
    createTable: (body: Json) => send('/api/merchant/tables', 'POST', body),
    updateTable: (id: string, body: Json) => send(`/api/merchant/tables/${id}`, 'PATCH', body),
    subscription: () => request<Json[]>('/api/merchant/subscription'),
    renewSubscription: (body: { planId: string; billingInterval: 'MONTHLY' | 'ANNUAL'; autoRenew: boolean; paymentMethod?: 'CARD' | 'BENEFIT' | 'BANK' }) =>
      send<{ scheduled: boolean; renewed: boolean; autoRenew: boolean; effectiveAt?: string; currentPeriodEnd?: string }>('/api/merchant/subscription/renew', 'POST', body as Json),
    setSubscriptionAutoRenew: (autoRenew: boolean) => send<{ autoRenew: boolean }>('/api/merchant/subscription/auto-renew', 'POST', { autoRenew }),
    invoices: () => request<{ id: string; number: string; amount: string; currency: string; status: string; kind: string; issuedAt: string }[]>('/api/merchant/invoices'),
    areas: () => request<Json[]>('/api/service-areas'),
    enterQr: (code: string) => send<Json>(`/api/qr/${code}/enter`, 'POST'),
    customer: () => request<Json>('/api/customers/me'),
    customerWallet: () => request<PortalWallet>('/api/customers/me/wallet'),
    requestCustomerWithdrawal: (amount: string) => send<{ id: string; amount: string; status: string }>('/api/customers/me/wallet/withdrawals', 'POST', { amount }),
    favourite: (merchantId: string) => send(`/api/customers/me/favourites/${merchantId}`, 'POST'),
    unfavourite: (merchantId: string) => send(`/api/customers/me/favourites/${merchantId}`, 'DELETE'),
    addAddress: (body: Json) => send<CustomerAddress>('/api/customers/me/addresses', 'POST', body),
    addresses: () => request<CustomerAddress[]>('/api/customers/me/addresses'),
    updateAddress: (id: string, body: Json) => send<CustomerAddress>(`/api/customers/me/addresses/${id}`, 'PATCH', body),
    deleteAddress: (id: string) => send<{ ok: true }>(`/api/customers/me/addresses/${id}`, 'DELETE'),
    nearestAddress: (lat: string | number, lng: string | number) =>
      request<NearestAddressView>(`/api/customers/me/addresses/nearest${queryString({ lat, lng })}`),
    guestLocation: () => request<{ location: { latitude: string; longitude: string; label: string | null; source: string | null; updatedAt: string | null } | null }>('/api/guests/location'),
    setGuestLocation: (body: { latitude: string | number; longitude: string | number; label?: string | null; source?: 'GPS' | 'SEARCH' | 'PIN' | 'AREA' | null }) =>
      send<{ saved: boolean; latitude: string; longitude: string; label: string | null }>('/api/guests/location', 'PUT', body as Json),
    reverseGeocode: (lat: string | number, lng: string | number, locale: 'en' | 'ar' = 'en', init?: RequestInit) =>
      request<ReverseGeocodeView>(`/api/geo/reverse${queryString({ lat, lng, locale })}`, init),
    nearby: (lat: string | number, lng: string | number) =>
      request<{ located: boolean; merchants: MerchantCard[]; closedMerchants: MerchantCard[] }>(`/api/storefront/nearby${queryString({ lat, lng })}`),
    deliveryQuote: (body: { addressId?: string | null; latitude?: string | number | null; longitude?: string | number | null; merchantId?: string | null; branchId?: string | null }) =>
      send<DeliveryQuoteView>('/api/delivery/quote', 'POST', body as Json),
    mergeCart: () => send<CartView>('/api/cart/merge', 'POST'),
    validateCheckout: (body: Json, init?: RequestInit) =>
      request<CheckoutSummary>('/api/checkout/validate', { ...init, method: 'POST', body: JSON.stringify(body) }),
    sessions: () => request<Page<Json> | Json[]>('/api/auth/sessions'),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
