import type {
  AdminDashboard,
  AuthUser,
  CartView,
  LoginResult,
  MerchantDashboard,
  MerchantStorefront,
  OrderView,
  Page,
  ProductDetail,
  ReportOverview,
  StorefrontHome,
  SubscriptionBoard,
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

export function createApiClient(baseUrl = '') {
  async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    if (typeof document !== 'undefined' && init.method && init.method !== 'GET') {
      const match = document.cookie.match(/(?:^|; )alliva_csrf=([^;]+)/);
      if (match?.[1]) headers.set('x-csrf-token', decodeURIComponent(match[1]));
    }
    const response = await fetch(`${baseUrl}${path}`, { ...init, headers, credentials: 'include' });
    if (response.status === 401 && retry && !path.includes('/auth/login') && !path.includes('/auth/refresh')) {
      const refreshed = await fetch(`${baseUrl}/api/auth/refresh`, { method: 'POST', credentials: 'include' });
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

  return {
    request,
    guest: () => send<{ id: string; csrfToken?: string }>('/api/guests', 'POST'),
    login: (body: { email: string; password: string; rememberDevice?: boolean }) =>
      send<LoginResult>('/api/auth/login', 'POST', body),
    verifyTwoFactor: (body: { challengeId: string; code: string }) =>
      send<LoginResult>('/api/auth/2fa/verify', 'POST', body),
    logout: () => send('/api/auth/logout', 'POST'),
    me: () => request<AuthUser>('/api/auth/me'),
    forgot: (email: string) => send<{ ok: boolean; devResetToken?: string }>('/api/auth/forgot-password', 'POST', { email }),
    reset: (token: string, password: string) => send('/api/auth/reset-password', 'POST', { token, password }),
    requestOtp: (phone: string) => send('/api/auth/otp/request', 'POST', { phone }),
    verifyOtp: (body: { phone: string; code: string; firstName?: string; lastName?: string }) =>
      send<LoginResult>('/api/auth/otp/verify', 'POST', body),
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
    merchantDashboard: () => request<MerchantDashboard>('/api/merchant/dashboard'),
    merchants: () => request<Json[]>('/api/admin/merchants'),
    publicPlans: () => request<SubscriptionPlanView[]>('/api/public/plans'),
    registerMerchant: (body: Json) => send('/api/public/merchant-registration', 'POST', body),
    createMerchant: (body: Json) => send('/api/admin/merchants', 'POST', body),
    approveMerchant: (id: string) => send(`/api/admin/merchants/${id}/approve`, 'POST'),
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
    promos: () => request<Json[]>('/api/promos'),
    createPromo: (body: Json) => send('/api/promos', 'POST', body),
    marketing: () => request<Json>('/api/marketing'),
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
    createProduct: (body: Json) => send('/api/catalog/products', 'POST', body),
    updateProduct: (id: string, body: Json) => send(`/api/catalog/products/${id}`, 'PATCH', body),
    createCategory: (body: Json) => send('/api/catalog/categories', 'POST', body),
    categories: () => request<Json[]>('/api/catalog/categories'),
    createOffer: (body: Json) => send('/api/catalog/offers', 'POST', body),
    profile: () => request<Json>('/api/merchant/profile'),
    updateProfile: (body: Json) => send('/api/merchant/profile', 'PATCH', body),
    upload: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      return request<{ url: string }>('/api/uploads', { method: 'POST', body });
    },
    setHours: (hours: Json) => send('/api/merchant/hours', 'POST', { hours }),
    createBranch: (body: Json) => send('/api/merchant/branches', 'POST', body),
    updateBranch: (id: string, body: Json) => send(`/api/merchant/branches/${id}`, 'PATCH', body),
    closeStore: (body: Json) => send('/api/merchant/closures', 'POST', body),
    tables: () => request<Json[]>('/api/merchant/tables'),
    createFloor: (body: Json) => send('/api/merchant/floors', 'POST', body),
    createTable: (body: Json) => send('/api/merchant/tables', 'POST', body),
    updateTable: (id: string, body: Json) => send(`/api/merchant/tables/${id}`, 'PATCH', body),
    subscription: () => request<Json[]>('/api/merchant/subscription'),
    invoices: () => request<{ id: string; number: string; amount: string; currency: string; status: string; kind: string; issuedAt: string }[]>('/api/merchant/invoices'),
    areas: () => request<Json[]>('/api/service-areas'),
    enterQr: (code: string) => send<Json>(`/api/qr/${code}/enter`, 'POST'),
    customer: () => request<Json>('/api/customers/me'),
    favourite: (merchantId: string) => send(`/api/customers/me/favourites/${merchantId}`, 'POST'),
    unfavourite: (merchantId: string) => send(`/api/customers/me/favourites/${merchantId}`, 'DELETE'),
    addAddress: (body: Json) => send('/api/customers/me/addresses', 'POST', body),
    sessions: () => request<Page<Json> | Json[]>('/api/auth/sessions'),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
