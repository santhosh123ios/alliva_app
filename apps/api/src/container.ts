import { AuditService } from './common/audit';
import { CryptoService } from './common/crypto';
import { JwtService } from './common/jwt';
import { CommerceService } from './modules/commerce.service';
import { DeliveryService } from './modules/delivery.service';
import { MarketingFinanceService } from './modules/marketing/finance.service';
import { MarketingPipelineService } from './modules/marketing/pipeline.service';
import { MarketingPromoService } from './modules/marketing/promo.service';
import { MarketingReferralService } from './modules/marketing/referral.service';
import { MarketingReportService } from './modules/marketing/report.service';
import { MarketingSettingsService } from './modules/marketing/settings';
import { MarketingTeamService } from './modules/marketing/team.service';
import { MarketingScheduler } from './jobs/marketing-scheduler';
import { OrdersGateway } from './modules/orders.gateway';
import { PlatformService } from './modules/platform.service';
import { RiderService } from './modules/rider.service';
import { DispatchService } from './modules/dispatch.service';
import { StoreOpsService } from './modules/store-ops.service';
import { FloorService } from './modules/floor.service';
import { BillingService } from './modules/billing.service';
import { PrismaService } from './prisma/prisma.service';
import { BenefitGateway, MockPushProvider, PaypalGateway, TapGateway } from './providers/mock.providers';
import { createEmailProvider } from './providers/resend';
import { createOtpProvider } from './providers/whatsapp.provider';
import { createDistanceProvider, createReverseGeocoder } from './providers/location';

export function createContainer() {
  const prisma = new PrismaService();
  const jwt = new JwtService(process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me', '15m');
  const crypto = new CryptoService();
  const audit = new AuditService(prisma);
  const gateway = new OrdersGateway(jwt, prisma);
  const marketingSettings = new MarketingSettingsService(prisma, audit);
  const promos = new MarketingPromoService(prisma, audit);
  const finance = new MarketingFinanceService(prisma, audit, marketingSettings);
  const platform = new PlatformService(prisma, audit, crypto, { promo: promos, finance });
  const delivery = new DeliveryService(prisma, createDistanceProvider());
  const commerce = new CommerceService(prisma, new TapGateway(), new BenefitGateway(), new PaypalGateway(), new MockPushProvider(), gateway, platform, delivery);
  const billing = new BillingService(prisma, gateway, commerce);
  const email = createEmailProvider();
  const referrals = new MarketingReferralService(prisma, audit, marketingSettings);
  const marketing = {
    settings: marketingSettings,
    promos,
    finance,
    referrals,
    team: new MarketingTeamService(prisma, audit, crypto, marketingSettings, email),
    pipeline: new MarketingPipelineService(prisma, audit, marketingSettings, referrals, promos, platform),
    reports: new MarketingReportService(prisma, marketingSettings),
    scheduler: new MarketingScheduler(prisma, marketingSettings, finance),
  };
  return {
    prisma,
    jwt,
    crypto,
    audit,
    gateway,
    platform,
    commerce,
    delivery,
    rider: new RiderService(prisma, commerce),
    dispatch: new DispatchService(prisma, commerce),
    storeOps: new StoreOpsService(prisma),
    floor: new FloorService(prisma, gateway, billing),
    billing,
    geocoder: createReverseGeocoder(),
    marketing,
    sms: createOtpProvider(),
    email,
  };
}

export type Container = ReturnType<typeof createContainer>;
