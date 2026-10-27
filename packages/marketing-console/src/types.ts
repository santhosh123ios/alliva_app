export type MemberRow = {
  id: string;
  kind: 'HEAD' | 'STAFF';
  status: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
  fullName: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  employeeId: string | null;
  region: string | null;
  joinedAt: string;
  notes: string | null;
  avatarUrl: string | null;
  referralCode: string | null;
  /** Personal override. Null means the platform default is in force. */
  commissionPercent: string | null;
  /** Rate that applies to the next payment. Present on profile detail. */
  effectiveCommissionPercent?: string;
  commissionIsDefault?: boolean;
  headName?: string;
  headUserId?: string | null;
  stats: { leads: number; referredStores: number; staffCount: number; earned: string | null; walletBalance: string | null } | null;
};

export type MemberDetail = MemberRow & {
  referralCodes: { code: string; active: boolean; createdAt: string; retiredAt: string | null }[];
  team: MemberRow[];
};

export type LeadRow = {
  id: string;
  staffId: string;
  staffName: string;
  headId: string | null;
  businessName: string;
  contactName: string;
  phone: string;
  whatsapp: string | null;
  email: string | null;
  category: string | null;
  city: string | null;
  area: string | null;
  address: string | null;
  mapsUrl: string | null;
  firstVisitAt: string | null;
  interestedPlanId: string | null;
  interestedPlanName: string | null;
  expectedRegistrationAt: string | null;
  notes: string | null;
  status: string;
  nextFollowUpAt: string | null;
  nextAppointmentAt: string | null;
  merchantId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AppointmentRow = {
  id: string;
  kind: 'APPOINTMENT' | 'FOLLOW_UP';
  leadId: string | null;
  merchantId: string | null;
  subject: string;
  title: string;
  scheduledAt: string;
  status: string;
  overdue: boolean;
  outcome: string | null;
  notes: string | null;
  completedAt: string | null;
  rescheduledFromId: string | null;
  staffName?: string;
  staffId?: string;
  place?: string | null;
  phone?: string | null;
  progress?: string | null;
  category?: string | null;
};

export type HistoryRow = { id: string; at: string; kind: string; body: string; fromStatus: string | null; toStatus: string | null; authorName: string };

export type LeadDetail = LeadRow & {
  headName: string;
  visits: { id: string; visitedAt: string; outcome: string | null; notes: string | null }[];
  appointments: AppointmentRow[];
  history: HistoryRow[];
};

export type VisitRow = { id: string; leadId: string; businessName: string; area: string | null; leadStatus: string; staffId: string; staffName: string; visitedAt: string; outcome: string | null; notes: string | null };

export type StoreRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  city: string;
  businessType: string | null;
  merchantStatus: string;
  subscriptionStatus: string | null;
  planName: string | null;
  staffId: string;
  staffName: string;
  referralCode: string;
  source: string;
  registeredAt: string;
  firstPayment: string | null;
  firstPaymentAt: string | null;
  commissionEarned: string | null;
};

export type CommissionRow = {
  id: string;
  merchantId: string;
  merchantName: string;
  beneficiaryId: string;
  beneficiaryName: string;
  staffName: string;
  headName: string;
  tier: 'STAFF' | 'HEAD';
  paymentId: string;
  paymentReference: string;
  planName: string;
  eligibleAmount: string;
  ratePercent: string;
  amount: string;
  reversedAmount: string;
  netAmount: string;
  status: string;
  createdAt: string;
  approvedAt: string | null;
};

export type Wallet = {
  userId: string;
  currency: string;
  available: string;
  pending: string;
  reserved: string;
  recoveryDue: string;
  totalEarned: string;
  totalWithdrawn: string;
  withdrawal: { cadence: 'WEEKLY' | 'MONTHLY'; minimum: string; methods: string[]; terms: { en: string; ar: string }; canRequest: boolean; nextAt: string | null; openRequests: number };
};

export type WalletTx = { id: string; userId: string; userName: string; type: string; bucket: string; amount: string; reference: string; reason: string | null; createdAt: string };

export type WithdrawalRow = {
  id: string;
  userId: string;
  userName?: string;
  email?: string | null;
  amount: string;
  status: string;
  payoutMethod: string | null;
  payoutReference: string | null;
  rejectionReason: string | null;
  note: string | null;
  createdAt: string;
  reviewedAt: string | null;
  paidAt: string | null;
};

export type WalletOverviewRow = { userId: string; name: string; kind: 'HEAD' | 'STAFF' | null; available: string; pending: string; reserved: string; recoveryDue: string; totalEarned: string; totalWithdrawn: string };

export type ActivityRow = { id: string; at: string; kind: string; body: string; fromStatus: string | null; toStatus: string | null; authorName: string; staffId: string | null; staffName: string; leadId: string | null; merchantId: string | null; subject: string };

export type NotificationRow = { id: string; title: string; body: string; link: string | null; entityType: string | null; entityId: string | null; read: boolean; at: string };

export type ReportTableData = {
  id: string;
  title: string;
  columns: { key: string; label: string; type?: 'text' | 'number' | 'money' | 'date' | 'percent' }[];
  rows: Record<string, string | number | null>[];
  totals: Record<string, string | number | null> | null;
  truncated: boolean;
  generatedAt: string;
};

export type PromoRow = {
  id: string;
  code: string;
  campaignName: string | null;
  description: { en: string; ar: string };
  discountType: 'PERCENTAGE' | 'FIXED';
  discountValue: string;
  maxDiscount: string | null;
  minimumAmount: string | null;
  planIds: string[] | null;
  startsAt: string;
  endsAt: string;
  usageLimit: number | null;
  perMerchantLimit: number | null;
  firstTimeMerchantOnly: boolean;
  campaignSource: string | null;
  active: boolean;
  status: string;
  assignedUser: { id: string; name: string } | null;
  assignedHead: { id: string; name: string } | null;
  uses: number;
  discountGiven: string;
  createdAt: string;
};

export type PromoUsageRow = { id: string; merchantId: string; merchantName: string; status: string; discountAmount: string; createdAt: string; appliedAt: string | null };

export type SettingsData = {
  staffPercent: string;
  headPercent: string;
  commissionBase: 'NET_PAID' | 'NET_EXCLUDING_TAX';
  firstPaymentOnly: boolean;
  approval: 'AUTO' | 'MANUAL' | 'HOLD_DAYS';
  holdDays: number;
  refundPolicy: 'PROPORTIONAL';
  referralPrefix: string;
  autoGenerateReferral: boolean;
  referralValidation: boolean;
  followUpAlerts: boolean;
  reminderOffsets: number[];
  overdueAlertHours: number;
  notifyHead: boolean;
  cadence: 'WEEKLY' | 'MONTHLY';
  minWithdrawal: string;
  payoutMethods: string[];
  withdrawalApproval: 'REQUIRED' | 'AUTO_REVIEW';
  withdrawalActiveOnly: boolean;
  terms: { en: string; ar: string };
  leadStatusLabels: Record<string, { en: string; ar: string }>;
  requireHead: boolean;
  allowStaffTransfer: boolean;
  headsCanReassignLeads: boolean;
  headsSeeReports: boolean;
  taxPercent: string;
};

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'VISITED', 'INTERESTED', 'FOLLOW_UP_REQUIRED', 'APPOINTMENT_SCHEDULED', 'NEGOTIATION', 'REGISTRATION_PENDING', 'REGISTERED', 'NOT_INTERESTED', 'CLOSED_LOST'] as const;

/** Statuses a staff member sets on a store they are contacting. */
export const STAFF_LEAD_STATUSES = ['NEW', 'CONTACTED', 'INTERESTED', 'NOT_INTERESTED'] as const;
