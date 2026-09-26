import '../src/load-env';
import { money, moneyString } from '../src/domain/money';
import { priceOrder } from '../src/domain/pricing';
import { buildCaptureLedger } from '../src/domain/ledger';
import { calculateSubscriptionCommission } from '../src/domain/commissions';
import { PrismaClient, Prisma } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();
const id = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const permissions = [
  'merchant.view', 'merchant.create', 'merchant.approve', 'merchant.suspend', 'merchant.profile.manage',
  'order.view', 'order.update', 'refund.request', 'refund.approve', 'payment.view', 'settlement.process',
  'subscription.manage', 'staff.manage', 'report.export', 'complaint.view', 'complaint.manage',
  'promo.manage', 'marketing.manage', 'settings.manage', 'audit.view', 'dispatch.manage',
  'catalog.manage', 'catalog.moderate', 'finance.view', 'customer.view', 'table.manage',
];

const merchantPerms = ['merchant.profile.manage', 'catalog.manage', 'order.view', 'order.update', 'staff.manage', 'table.manage', 'payment.view', 'report.export', 'refund.request', 'complaint.view'];

const roleMap: Record<string, string[]> = {
  SUPER_ADMIN: permissions,
  ADMIN: permissions,
  OPERATIONS_MANAGER: ['order.view', 'order.update', 'dispatch.manage', 'complaint.view', 'complaint.manage', 'merchant.view', 'refund.request', 'catalog.moderate', 'customer.view'],
  OPERATIONS_STAFF: ['order.view', 'order.update', 'dispatch.manage', 'complaint.view'],
  MARKETING_HEAD: ['marketing.manage', 'promo.manage', 'merchant.view', 'report.export'],
  MARKETING_STAFF: ['promo.manage', 'merchant.view'],
  FINANCE_MANAGER: ['payment.view', 'settlement.process', 'refund.approve', 'finance.view', 'report.export', 'audit.view'],
  FINANCE_STAFF: ['payment.view', 'finance.view', 'refund.request'],
  CUSTOMER_SUPPORT: ['complaint.view', 'complaint.manage', 'order.view', 'customer.view', 'refund.request'],
  MERCHANT_OWNER: merchantPerms,
  MERCHANT_MANAGER: merchantPerms.filter((key) => key !== 'staff.manage'),
  ORDER_TAKING_STAFF: ['order.view', 'order.update'],
  KITCHEN_STAFF: ['order.view', 'order.update'],
  BILLING_STAFF: ['payment.view', 'order.view'],
  DELIVERY_STAFF: ['order.view', 'order.update'],
  REPORT_VIEWER: ['order.view', 'payment.view', 'report.export'],
};

const roleNames: Record<string, { en: string; ar: string }> = {
  SUPER_ADMIN: { en: 'Super Admin', ar: 'مدير أعلى' },
  ADMIN: { en: 'Admin', ar: 'مدير' },
  OPERATIONS_MANAGER: { en: 'Operations Manager', ar: 'مدير العمليات' },
  OPERATIONS_STAFF: { en: 'Operations Staff', ar: 'موظف عمليات' },
  MARKETING_HEAD: { en: 'Marketing Head', ar: 'رئيس التسويق' },
  MARKETING_STAFF: { en: 'Marketing Staff', ar: 'موظف تسويق' },
  FINANCE_MANAGER: { en: 'Finance Manager', ar: 'مدير المالية' },
  FINANCE_STAFF: { en: 'Finance Staff', ar: 'موظف مالية' },
  CUSTOMER_SUPPORT: { en: 'Customer Support', ar: 'دعم العملاء' },
  MERCHANT_OWNER: { en: 'Merchant Owner', ar: 'مالك المتجر' },
  MERCHANT_MANAGER: { en: 'Merchant Manager', ar: 'مدير المتجر' },
  ORDER_TAKING_STAFF: { en: 'Order-Taking Staff', ar: 'موظف الطلبات' },
  KITCHEN_STAFF: { en: 'Kitchen Staff', ar: 'موظف المطبخ' },
  BILLING_STAFF: { en: 'Billing Staff', ar: 'موظف الفوترة' },
  DELIVERY_STAFF: { en: 'Delivery Staff', ar: 'موظف التوصيل' },
  REPORT_VIEWER: { en: 'Report Viewer', ar: 'مشاهد التقارير' },
};

async function main() {
  const passwordHash = await argon2.hash('Alliva123!');
  for (const key of permissions) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { id: id(100 + permissions.indexOf(key)), key } });
  }
  const permissionRows = await prisma.permission.findMany();
  const byKey = new Map(permissionRows.map((row) => [row.key, row.id]));
  let roleIndex = 0;
  for (const [key, grants] of Object.entries(roleMap)) {
    const role = await prisma.role.upsert({
      where: { key },
      update: { name: roleNames[key] },
      create: { id: id(200 + roleIndex), key, name: roleNames[key], description: roleNames[key] },
    });
    roleIndex += 1;
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: grants.map((grant) => ({ roleId: role.id, permissionId: byKey.get(grant)! })),
    });
  }

  const categories = [
    ['restaurants', 'Restaurants', 'مطاعم'],
    ['cafes', 'Cafes', 'مقاهي'],
    ['groceries', 'Groceries', 'بقالة'],
    ['sweets', 'Sweets', 'حلويات'],
    ['healthy', 'Healthy', 'صحي'],
  ];
  for (const [index, [slug, en, ar]] of categories.entries()) {
    await prisma.businessCategory.upsert({
      where: { slug },
      update: {},
      create: { id: id(300 + index), slug, name: { en, ar }, sortOrder: index },
    });
  }

  const marketplace = await prisma.subscriptionPlan.upsert({
    where: { code: 'marketplace-growth' },
    update: {},
    create: {
      id: id(400),
      code: 'marketplace-growth',
      name: { en: 'Marketplace Growth', ar: 'نمو السوق' },
      description: { en: 'Appear beside similar businesses across Bahrain.', ar: 'الظهور إلى جانب الأنشطة المشابهة في البحرين.' },
      priceMonthly: '49.000',
      priceAnnual: '490.000',
    },
  });
  const exclusive = await prisma.subscriptionPlan.upsert({
    where: { code: 'exclusive-storefront' },
    update: {},
    create: {
      id: id(401),
      code: 'exclusive-storefront',
      name: { en: 'Exclusive Storefront', ar: 'واجهة حصرية' },
      description: { en: 'Customers who scan your QR see only your shop.', ar: 'من يمسح رمزك يرى متجرك فقط.' },
      priceMonthly: '79.000',
      priceAnnual: '790.000',
    },
  });
  const entitlementRows = (planId: string, rows: [string, unknown][]) =>
    rows.map(([key, value]) => ({ planId, key, value: value as Prisma.InputJsonValue }));
  const ensureEntitlements = async (planId: string, rows: [string, unknown][]) => {
    const existing = await prisma.planEntitlement.count({ where: { planId } });
    if (existing > 0) return;
    await prisma.planEntitlement.createMany({ data: entitlementRows(planId, rows) });
  };
  await ensureEntitlements(marketplace.id, [
    ['visibility', 'ALL_STORES'], ['monthlyOrderLimit', 1000], ['productLimit', 200], ['branchLimit', 5],
    ['staffLimit', 25], ['offerHighlighting', true], ['bannerAdvertising', true], ['paymentIntegration', true],
    ['deliveryOrdering', true], ['takeawayOrdering', true], ['tableOrdering', true], ['tableCountLimit', 40],
    ['merchantPromoCodes', true], ['transactionalNotifications', true], ['promotionalNotifications', true],
    ['supportLevel', 'PRIORITY'], ['reporting', 'ADVANCED'], ['merchantCommissionPercent', '12.000'],
    ['billingIntervals', ['MONTHLY', 'ANNUAL']],
  ]);
  await ensureEntitlements(exclusive.id, [
    ['visibility', 'CURRENT_STORE_ONLY'], ['monthlyOrderLimit', 300], ['productLimit', 80], ['branchLimit', 1],
    ['staffLimit', 10], ['offerHighlighting', false], ['bannerAdvertising', false], ['paymentIntegration', true],
    ['deliveryOrdering', true], ['takeawayOrdering', true], ['tableOrdering', true], ['tableCountLimit', 20],
    ['merchantPromoCodes', false], ['transactionalNotifications', true], ['promotionalNotifications', false],
    ['supportLevel', 'STANDARD'], ['reporting', 'BASIC'], ['merchantCommissionPercent', '8.000'],
    ['billingIntervals', ['MONTHLY', 'ANNUAL']],
  ]);
  await ensureCatalogPlan(prisma, {
    code: 'base',
    name: { en: 'Base', ar: 'الأساس' },
    description: { en: 'Your storefront, without other-store suggestions.', ar: 'واجهتك دون اقتراح متاجر أخرى.' },
    priceMonthly: '10.000',
    priceAnnual: '120.000',
    displayOrder: 1,
    recommended: false,
    entitlements: [
      ['visibility', 'CURRENT_STORE_ONLY'], ['productLimit', 40], ['monthlyOrderLimit', 200], ['offerHighlighting', false],
      ['paymentIntegration', false], ['deliveryOrdering', true], ['takeawayOrdering', true], ['tableOrdering', false], ['tableCountLimit', null],
      ['staffLimit', 3], ['branchLimit', 1], ['merchantPromoCodes', false], ['reporting', 'BASIC'],
      ['transactionalNotifications', true], ['promotionalNotifications', false], ['supportLevel', 'STANDARD'],
      ['merchantCommissionPercent', '8.000'], ['billingIntervals', ['MONTHLY']],
    ],
  });
  await ensureCatalogPlan(prisma, {
    code: 'core',
    name: { en: 'Core', ar: 'الأساس المتقدم' },
    description: { en: 'Suggestions skip stores in your business type.', ar: 'الاقتراحات تستثني أنشطة من نفس نوع عملك.' },
    priceMonthly: '20.000',
    priceAnnual: '240.000',
    displayOrder: 2,
    recommended: true,
    entitlements: [
      ['visibility', 'EXCLUDE_SAME_BUSINESS_TYPE'], ['productLimit', 120], ['monthlyOrderLimit', 800], ['offerHighlighting', true],
      ['paymentIntegration', true], ['deliveryOrdering', true], ['takeawayOrdering', true], ['tableOrdering', true], ['tableCountLimit', 20],
      ['staffLimit', 10], ['branchLimit', 2], ['merchantPromoCodes', true], ['reporting', 'STANDARD'],
      ['transactionalNotifications', true], ['promotionalNotifications', true], ['supportLevel', 'STANDARD'],
      ['merchantCommissionPercent', '10.000'], ['billingIntervals', ['MONTHLY']],
    ],
  });
  await ensureCatalogPlan(prisma, {
    code: 'pro',
    name: { en: 'Pro', ar: 'الاحترافي' },
    description: { en: 'Suggestions can include any business type.', ar: 'يمكن أن تشمل الاقتراحات أي نوع نشاط.' },
    priceMonthly: '40.000',
    priceAnnual: '480.000',
    displayOrder: 3,
    recommended: false,
    entitlements: [
      ['visibility', 'ALL_STORES'], ['productLimit', null], ['monthlyOrderLimit', null], ['offerHighlighting', true],
      ['paymentIntegration', true], ['deliveryOrdering', true], ['takeawayOrdering', true], ['tableOrdering', true], ['tableCountLimit', null],
      ['staffLimit', null], ['branchLimit', null], ['merchantPromoCodes', true], ['reporting', 'ADVANCED'],
      ['transactionalNotifications', true], ['promotionalNotifications', true], ['supportLevel', 'PRIORITY'],
      ['merchantCommissionPercent', '12.000'], ['billingIntervals', ['MONTHLY']],
    ],
  });

  const merchants = [
    { key: 1, slug: 'saffron-house', en: 'Saffron House', ar: 'بيت الزعفران', type: 'Bahraini kitchen', city: 'Manama', lat: '26.228500', lng: '50.586000', category: 'restaurants', plan: marketplace.id, phone: '+97317000001' },
    { key: 2, slug: 'pearl-grill', en: 'Pearl Grill', ar: 'مشواة اللؤلؤ', type: 'Grill', city: 'Muharraq', lat: '26.257200', lng: '50.611900', category: 'restaurants', plan: marketplace.id, phone: '+97317000002' },
    { key: 3, slug: 'date-and-thyme', en: 'Date & Thyme', ar: 'تمر وزعتر', type: 'Cafe', city: 'Riffa', lat: '26.130000', lng: '50.555000', category: 'cafes', plan: marketplace.id, phone: '+97317000003' },
    { key: 4, slug: 'harbour-bowl', en: 'Harbour Bowl', ar: 'وعاء الميناء', type: 'Healthy bowls', city: 'Isa Town', lat: '26.173600', lng: '50.547800', category: 'healthy', plan: marketplace.id, phone: '+97317000004' },
    { key: 5, slug: 'night-souq-sweets', en: 'Night Souq Sweets', ar: 'حلويات سوق الليل', type: 'Sweets', city: 'Manama', lat: '26.236100', lng: '50.583000', category: 'sweets', plan: exclusive.id, phone: '+97317000005' },
  ];

  for (const merchant of merchants) {
    const category = await prisma.businessCategory.findUniqueOrThrow({ where: { slug: merchant.category } });
    await prisma.merchant.upsert({
      where: { slug: merchant.slug },
      update: {},
      create: {
        id: id(500 + merchant.key),
        slug: merchant.slug,
        name: { en: merchant.en, ar: merchant.ar },
        description: { en: `${merchant.en} cooks for Manama, Muharraq, Riffa and Isa Town.`, ar: `${merchant.ar} يقدّم طلبات في المنامة والمحرق والرفاع ومدينة عيسى.` },
        businessType: merchant.type,
        status: 'ACTIVE',
        phone: merchant.phone,
        email: `hello@${merchant.slug}.bh`,
        minimumOrder: '2.000',
        preparationMinutes: 20,
        deliveryEnabled: true,
        takeawayEnabled: true,
        dineInEnabled: merchant.key === 1 || merchant.key === 5,
        ratingAverage: '4.60',
        ratingCount: 12,
        categories: { create: { categoryId: category.id } },
        branches: {
          create: {
            id: id(600 + merchant.key),
            name: { en: `${merchant.city} branch`, ar: `فرع ${merchant.city}` },
            line1: `Building ${merchant.key}, Road ${merchant.key + 10}`,
            city: merchant.city,
            latitude: merchant.lat,
            longitude: merchant.lng,
          },
        },
      },
    });
    const start = new Date();
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    await prisma.merchantSubscription.upsert({
      where: { merchantId: id(500 + merchant.key) },
      update: {},
      create: {
        id: id(700 + merchant.key),
        merchantId: id(500 + merchant.key),
        planId: merchant.plan,
        billingInterval: 'MONTHLY',
        status: 'ACTIVE',
        currentPeriodStart: start,
        currentPeriodEnd: end,
      },
    });
    await prisma.operatingHour.deleteMany({ where: { merchantId: id(500 + merchant.key) } });
    await prisma.operatingHour.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((day) => ({
        merchantId: id(500 + merchant.key),
        dayOfWeek: day,
        opensAt: '00:00',
        closesAt: '23:59',
        closed: false,
      })),
    });
  }

  const staff = [
    ['superadmin@alliva.bh', 'SUPER_ADMIN', 'Layla', 'Al Khalifa'],
    ['admin@alliva.bh', 'ADMIN', 'Hassan', 'Al Arrayed'],
    ['ops.manager@alliva.bh', 'OPERATIONS_MANAGER', 'Noor', 'Fakhro'],
    ['ops.staff@alliva.bh', 'OPERATIONS_STAFF', 'Yusuf', 'Al Mannai'],
    ['marketing.head@alliva.bh', 'MARKETING_HEAD', 'Mariam', 'Al Doseri'],
    ['marketing.staff@alliva.bh', 'MARKETING_STAFF', 'Omar', 'Sharif'],
    ['finance.manager@alliva.bh', 'FINANCE_MANAGER', 'Huda', 'Qamber'],
    ['finance.staff@alliva.bh', 'FINANCE_STAFF', 'Ali', 'Matar'],
    ['support@alliva.bh', 'CUSTOMER_SUPPORT', 'Sara', 'Buallay'],
  ] as const;
  for (const [index, [email, roleKey, firstName, lastName]] of staff.entries()) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    const user = await prisma.user.upsert({
      where: { email },
      update: { passwordHash, status: 'ACTIVE' },
      create: {
        id: id(800 + index),
        email,
        passwordHash,
        kind: 'STAFF',
        status: 'ACTIVE',
        firstName,
        lastName,
        twoFactorEnabled: email === 'finance.manager@alliva.bh',
        userRoles: { create: { roleId: role.id } },
      },
    });
    if (roleKey === 'MARKETING_HEAD' || roleKey === 'MARKETING_STAFF') {
      const head = await prisma.user.findUnique({ where: { email: 'marketing.head@alliva.bh' } });
      await prisma.marketingProfile.upsert({
        where: { userId: user.id },
        update: {},
        create: {
          userId: user.id,
          parentUserId: roleKey === 'MARKETING_STAFF' ? head?.id : null,
          referralCode: roleKey === 'MARKETING_HEAD' ? 'HEAD100' : 'OMAR20',
          staffCommissionPercent: '8.000',
          headOverridePercent: roleKey === 'MARKETING_STAFF' ? '2.000' : '0.000',
          renewalCommissionEnabled: false,
          maxCommission: '25.000',
        },
      });
    }
  }

  const merchantStaff = [
    ['owner@saffronhouse.bh', 'MERCHANT_OWNER', 'Fatima', 'Al Sayed'],
    ['manager@saffronhouse.bh', 'MERCHANT_MANAGER', 'Khalid', 'Nasser'],
    ['orders@saffronhouse.bh', 'ORDER_TAKING_STAFF', 'Amina', 'Husain'],
    ['kitchen@saffronhouse.bh', 'KITCHEN_STAFF', 'Rashid', 'Ali'],
    ['billing@saffronhouse.bh', 'BILLING_STAFF', 'Dana', 'Saleh'],
    ['driver@saffronhouse.bh', 'DELIVERY_STAFF', 'Hamad', 'Jassim'],
    ['reports@saffronhouse.bh', 'REPORT_VIEWER', 'Lulwa', 'Ahmed'],
  ] as const;
  for (const [index, [email, roleKey, firstName, lastName]] of merchantStaff.entries()) {
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
    await prisma.user.upsert({
      where: { email },
      update: { passwordHash, status: 'ACTIVE', merchantId: id(501) },
      create: {
        id: id(900 + index),
        email,
        passwordHash,
        kind: 'MERCHANT_USER',
        status: 'ACTIVE',
        firstName,
        lastName,
        merchantId: id(501),
        userRoles: { create: { roleId: role.id, merchantId: id(501) } },
        ...(roleKey === 'DELIVERY_STAFF' ? { driverProfile: { create: { id: id(910), merchantId: id(501), vehicle: 'Motorbike', active: true } } } : {}),
      },
    });
  }

  const customer = await prisma.user.upsert({
    where: { phone: '+97336000001' },
    update: {},
    create: {
      id: id(950),
      phone: '+97336000001',
      kind: 'CUSTOMER',
      status: 'ACTIVE',
      firstName: 'Abdulla',
      lastName: 'Kanoo',
      customer: { create: { id: id(951), rewardBalance: '1.500' } },
    },
    include: { customer: true },
  });
  await prisma.address.upsert({
    where: { id: id(952) },
    update: {},
    create: {
      id: id(952),
      customerId: customer.customer!.id,
      label: 'Home',
      line1: 'Road 2406, Block 324',
      city: 'Manama',
      latitude: '26.223500',
      longitude: '50.587800',
      isDefault: true,
    },
  });

  const saffronProducts = [
    ['Machboos chicken', 'مجبوس دجاج', '8.500'],
    ['Grilled hamour', 'هامور مشوي', '9.750'],
    ['Saffron rice', 'أرز بالزعفران', '2.250'],
  ];
  for (const [index, [en, ar, price]] of saffronProducts.entries()) {
    const category = await prisma.productCategory.upsert({
      where: { id: id(1000) },
      update: {},
      create: { id: id(1000), merchantId: id(501), name: { en: 'Kitchen', ar: 'المطبخ' }, sortOrder: 0 },
    });
    await prisma.product.upsert({
      where: { merchantId_slug: { merchantId: id(501), slug: slug(en) } },
      update: {},
      create: {
        id: id(1100 + index),
        merchantId: id(501),
        categoryId: category.id,
        slug: slug(en),
        name: { en, ar },
        description: { en: `${en} from Saffron House.`, ar: `${ar} من بيت الزعفران.` },
        price,
        approvalStatus: 'APPROVED',
        available: true,
        ratingAverage: '4.70',
        inventory: { create: { merchantId: id(501), branchId: id(601), quantity: index === 2 ? 3 : 40, lowStockThreshold: 5 } },
      },
    });
  }
  for (const [key, en, ar, sortOrder] of [
    [1001, 'Coffee', 'قهوة', 1],
    [1002, 'Bakery', 'مخبز', 2],
    [1003, 'Breakfast', 'فطور', 3],
    [1004, 'Drinks', 'مشروبات', 4],
  ] as const) {
    await prisma.productCategory.upsert({
      where: { id: id(key) },
      update: { name: { en, ar }, sortOrder },
      create: { id: id(key), merchantId: id(501), name: { en, ar }, sortOrder },
    });
  }
  const addonGroup = await prisma.addonGroup.upsert({
    where: { id: id(1200) },
    update: {},
    create: {
      id: id(1200),
      merchantId: id(501),
      name: { en: 'Extras', ar: 'إضافات' },
      minSelect: 0,
      maxSelect: 2,
      addons: {
        create: [
          { id: id(1201), merchantId: id(501), name: { en: 'Extra sauce', ar: 'صلصة إضافية' }, price: '0.300' },
          { id: id(1202), merchantId: id(501), name: { en: 'Pickled mango', ar: 'طرشي مانجو' }, price: '0.400' },
        ],
      },
    },
  });
  await prisma.productAddonGroup.upsert({
    where: { productId_addonGroupId: { productId: id(1100), addonGroupId: addonGroup.id } },
    update: {},
    create: { productId: id(1100), addonGroupId: addonGroup.id },
  });

  for (const merchant of merchants.filter((item) => item.key !== 1)) {
    const category = await prisma.productCategory.create({
      data: { id: id(1300 + merchant.key), merchantId: id(500 + merchant.key), name: { en: 'Menu', ar: 'القائمة' } },
    });
    await prisma.product.create({
      data: {
        id: id(1400 + merchant.key),
        merchantId: id(500 + merchant.key),
        categoryId: category.id,
        slug: 'house-special',
        name: { en: `${merchant.en} special`, ar: `طبق ${merchant.ar}` },
        description: { en: 'House special prepared today.', ar: 'طبق اليوم.' },
        price: '4.500',
        approvalStatus: 'APPROVED',
        inventory: { create: { merchantId: id(500 + merchant.key), branchId: id(600 + merchant.key), quantity: 25, lowStockThreshold: 5 } },
      },
    });
  }

  await prisma.offer.create({ data: { merchantId: id(501), title: { en: 'Lunch machboos', ar: 'مجبوس الغداء' }, startsAt: new Date(), endsAt: new Date(Date.now() + 30 * 86400000) } });
  await prisma.banner.create({ data: { merchantId: id(502), title: { en: 'Pearl Grill evenings', ar: 'أمسيات مشواة اللؤلؤ' }, status: 'ACTIVE', imageUrl: '/mascot.png' } });

  const quote = priceOrder({
    lines: [{ unitPrice: '8.500', quantity: 1 }],
    fulfillment: 'DELIVERY',
    deliveryFee: '0.500',
    freeDeliveryMinimum: '8.000',
    taxRate: '0.100',
    promo: null,
  });
  const order = await prisma.order.upsert({
    where: { number: 'ALV-10001' },
    update: {},
    create: {
      id: id(1500),
      number: 'ALV-10001',
      customerId: customer.customer!.id,
      merchantId: id(501),
      branchId: id(601),
      fulfillmentType: 'DELIVERY',
      status: 'DELIVERED',
      subtotal: quote.subtotal,
      discount: quote.discount,
      deliveryFee: quote.deliveryFee,
      deliveryFeeSaved: quote.deliveryFeeSaved,
      tax: quote.tax,
      total: quote.total,
      commissionPercent: '12.000',
      platformCommission: moneyString(money(quote.subtotal).minus(quote.discount).mul('0.12')),
      merchantNet: moneyString(money(quote.subtotal).minus(quote.discount).mul('0.88')),
      items: { create: { merchantId: id(501), productId: id(1100), name: { en: 'Machboos chicken', ar: 'مجبوس دجاج' }, quantity: 1, unitPrice: '8.500', lineTotal: '8.500' } },
      events: { create: [{ status: 'PENDING' }, { status: 'DELIVERED', note: 'Delivered in Seef' }] },
    },
  });
  const lines = buildCaptureLedger({
    total: quote.total,
    foodAfterDiscount: moneyString(money(quote.subtotal).minus(quote.discount)),
    tax: quote.tax,
    deliveryFee: quote.deliveryFee,
    commissionRate: '0.12',
    gatewayRate: '0.025',
    payDriver: true,
    referenceId: order.id,
  });
  for (const line of lines) {
    await prisma.ledgerEntry.upsert({
      where: { idempotencyKey: `${order.id}:${line.type}` },
      update: {},
      create: { ...line, merchantId: id(501), idempotencyKey: `${order.id}:${line.type}` },
    });
  }
  await prisma.payment.upsert({
    where: { idempotencyKey: 'seed-order-10001' },
    update: {},
    create: { orderId: order.id, customerId: customer.customer!.id, merchantId: id(501), provider: 'TAP', method: 'CARD', status: 'CAPTURED', amount: quote.total, gatewayFee: moneyString(money(quote.total).mul('0.025')), idempotencyKey: 'seed-order-10001', externalId: 'tap_seed' },
  });
  await prisma.order.upsert({
    where: { number: 'ALV-10002' },
    update: {},
    create: {
      id: id(1501),
      number: 'ALV-10002',
      customerId: customer.customer!.id,
      merchantId: id(501),
      branchId: id(601),
      fulfillmentType: 'DELIVERY',
      status: 'PENDING',
      subtotal: '9.750',
      discount: '0.000',
      deliveryFee: '0.500',
      deliveryFeeSaved: '0.000',
      tax: '0.975',
      total: '11.225',
      commissionPercent: '12.000',
      platformCommission: '1.170',
      merchantNet: '8.580',
      items: { create: { merchantId: id(501), productId: id(1101), name: { en: 'Grilled hamour', ar: 'هامور مشوي' }, quantity: 1, unitPrice: '9.750', lineTotal: '9.750' } },
      events: { create: { status: 'PENDING', note: 'Waiting for the kitchen' } },
    },
  });

  await prisma.complaint.upsert({
    where: { id: id(1600) },
    update: {},
    create: {
      id: id(1600),
      source: 'CUSTOMER',
      category: 'Late delivery',
      priority: 'HIGH',
      status: 'OPEN',
      subject: 'Order arrived late',
      description: 'The machboos arrived 25 minutes after the estimate.',
      orderId: order.id,
      merchantId: id(501),
      reporterId: customer.id,
    },
  });

  const marketingStaff = await prisma.user.findUniqueOrThrow({ where: { email: 'marketing.staff@alliva.bh' } });
  await prisma.merchantReferral.upsert({
    where: { merchantId: id(501) },
    update: {},
    create: { merchantId: id(501), marketingUserId: marketingStaff.id, codeUsed: 'OMAR20' },
  });
  const subscription = await prisma.merchantSubscription.findUniqueOrThrow({ where: { merchantId: id(501) } });
  const subPayment = await prisma.subscriptionPayment.upsert({
    where: { idempotencyKey: 'seed-sub-saffron' },
    update: {},
    create: { subscriptionId: subscription.id, merchantId: id(501), amount: '49.000', status: 'CAPTURED', isRenewal: false, verifiedAt: new Date(), idempotencyKey: 'seed-sub-saffron' },
  });
  const profile = await prisma.marketingProfile.findUniqueOrThrow({ where: { userId: marketingStaff.id } });
  const split = calculateSubscriptionCommission({
    paymentAmount: '49.000',
    staffPercent: '8.000',
    headOverridePercent: '2.000',
    maxCommission: '25.000',
    isRenewal: false,
    renewalEnabled: false,
    paymentVerified: true,
  });
  if (split) {
    await prisma.commissionEntry.upsert({
      where: { id: id(1700) },
      update: {},
      create: { id: id(1700), subscriptionPaymentId: subPayment.id, merchantId: id(501), beneficiaryUserId: marketingStaff.id, tier: 'STAFF', amount: split.staffAmount, pendingUntil: new Date(Date.now() + 14 * 86400000) },
    });
    if (profile.parentUserId) {
      await prisma.commissionEntry.upsert({
        where: { id: id(1701) },
        update: {},
        create: { id: id(1701), subscriptionPaymentId: subPayment.id, merchantId: id(501), beneficiaryUserId: profile.parentUserId, tier: 'HEAD', amount: split.headAmount, pendingUntil: new Date(Date.now() + 14 * 86400000) },
      });
    }
  }

  const promoStart = new Date(Date.now() - 86400000);
  const promoEnd = new Date(Date.now() + 60 * 86400000);
  await prisma.promoCode.upsert({
    where: { code: 'WELCOME10' },
    update: {},
    create: {
      code: 'WELCOME10',
      description: { en: 'Ten percent off a first order', ar: 'خصم عشرة بالمئة على أول طلب' },
      scope: 'GLOBAL',
      discountType: 'PERCENTAGE',
      discountValue: '10.000',
      maxDiscount: '2.000',
      minimumOrder: '5.000',
      usageLimit: 500,
      perCustomerLimit: 1,
      startsAt: promoStart,
      endsAt: promoEnd,
      firstOrderOnly: true,
      budget: '200.000',
    },
  });

  const floor = await prisma.floor.upsert({
    where: { id: id(1800) },
    update: {},
    create: { id: id(1800), merchantId: id(501), name: { en: 'Ground floor', ar: 'الدور الأرضي' } },
  });
  await prisma.diningTable.upsert({
    where: { merchantId_number: { merchantId: id(501), number: '12' } },
    update: {},
    create: { id: id(1801), merchantId: id(501), floorId: floor.id, name: 'Window', number: '12', capacity: 4 },
  });
  await prisma.qrCode.upsert({
    where: { code: 'SAFFRON' },
    update: {},
    create: { code: 'SAFFRON', type: 'MERCHANT', merchantId: id(501) },
  });
  await prisma.qrCode.upsert({
    where: { code: 'TABLE12' },
    update: {},
    create: { code: 'TABLE12', type: 'TABLE', merchantId: id(501), tableId: id(1801) },
  });
  await prisma.qrCode.upsert({
    where: { code: 'NIGHTSOUQ' },
    update: {},
    create: { code: 'NIGHTSOUQ', type: 'MERCHANT', merchantId: id(505) },
  });

  const settings: [string, Prisma.InputJsonValue][] = [
    ['taxRate', '0.100'],
    ['currency', 'BHD'],
    ['timezone', 'Asia/Bahrain'],
    ['maintenanceMode', false],
    ['supportPhone', '+97317000100'],
    ['terms', { en: 'Alliva terms for Bahrain customers.', ar: 'شروط أليفا لعملاء البحرين.' }],
    ['privacy', { en: 'Alliva privacy notice.', ar: 'إشعار خصوصية أليفا.' }],
  ];
  for (const [key, value] of settings) {
    await prisma.platformSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }
  await prisma.serviceArea.upsert({
    where: { id: id(1900) },
    update: {},
    create: {
      id: id(1900),
      name: { en: 'Bahrain', ar: 'البحرين' },
      city: 'Manama',
      latitude: '26.066700',
      longitude: '50.557700',
      geoJson: { type: 'Polygon', coordinates: [[[50.45, 25.8], [50.75, 25.8], [50.75, 26.35], [50.45, 26.35], [50.45, 25.8]]] },
    },
  });
  await prisma.deliveryPricingRule.create({ data: { name: { en: 'Bahrain base', ar: 'أساس البحرين' }, baseFee: '0.500', perKmFee: '0.100' } }).catch(() => undefined);
  await prisma.freeDeliveryRule.create({ data: { minimumOrder: '8.000' } }).catch(() => undefined);
  await prisma.paymentGatewayConfig.upsert({ where: { provider: 'TAP' }, update: {}, create: { provider: 'TAP', enabled: true, publicConfig: { feeRate: '0.025' } } });
  await prisma.paymentGatewayConfig.upsert({ where: { provider: 'BENEFIT' }, update: {}, create: { provider: 'BENEFIT', enabled: true, publicConfig: { feeRate: '0.025' } } });
  await prisma.notificationTemplate.upsert({
    where: { key: 'order.updated' },
    update: {},
    create: { key: 'order.updated', channel: 'IN_APP', subject: { en: 'Order update', ar: 'تحديث الطلب' }, body: { en: 'Your order status changed.', ar: 'تغيرت حالة طلبك.' } },
  });
  await prisma.settlement.upsert({
    where: { id: id(2000) },
    update: {},
    create: { id: id(2000), merchantId: id(501), amount: '8.580', status: 'PENDING_APPROVAL', periodStart: new Date(Date.now() - 7 * 86400000), periodEnd: new Date(), lines: { create: { description: 'ALV-10001 merchant net', amount: '8.580', orderId: order.id } } },
  });

  await prisma.$executeRawUnsafe(`
    UPDATE "Branch" SET location = ST_SetSRID(ST_MakePoint(longitude::float8, latitude::float8), 4326)::geography
  `).catch(() => undefined);
  await prisma.$executeRawUnsafe(`
    UPDATE "ServiceArea" SET area = ST_SetSRID(ST_GeomFromGeoJSON("geoJson"::text), 4326)::geography
  `).catch(() => undefined);
}

async function ensureCatalogPlan(db: PrismaClient, plan: {
  code: string;
  name: { en: string; ar: string };
  description: { en: string; ar: string };
  priceMonthly: string;
  priceAnnual: string;
  displayOrder: number;
  recommended: boolean;
  entitlements: [string, unknown][];
}) {
  const existing = await db.subscriptionPlan.findUnique({ where: { code: plan.code } });
  if (existing) return existing;
  return db.subscriptionPlan.create({
    data: {
      code: plan.code,
      name: plan.name,
      description: plan.description,
      priceMonthly: plan.priceMonthly,
      priceAnnual: plan.priceAnnual,
      status: 'ACTIVE',
      displayOrder: plan.displayOrder,
      recommended: plan.recommended,
      entitlements: { create: plan.entitlements.map(([key, value]) => ({ key, value: value as Prisma.InputJsonValue })) },
    },
  });
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
