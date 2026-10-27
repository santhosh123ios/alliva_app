import { AuditService } from './common/audit';
import { CryptoService } from './common/crypto';
import { JwtService } from './common/jwt';
import { CommerceService } from './modules/commerce.service';
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
import { PrismaService } from './prisma/prisma.service';
import { BenefitGateway, MockPushProvider, TapGateway } from './providers/mock.providers';
import { createEmailProvider } from './providers/resend';
import { createOtpProvider } from './providers/whatsapp.provider';

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
  const commerce = new CommerceService(prisma, new TapGateway(), new BenefitGateway(), new MockPushProvider(), gateway, platform);
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
    marketing,
    sms: createOtpProvider(),
    email,
  };
}

export type Container = ReturnType<typeof createContainer>;
