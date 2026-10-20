import { AuditService } from './common/audit';
import { CryptoService } from './common/crypto';
import { JwtService } from './common/jwt';
import { CommerceService } from './modules/commerce.service';
import { OrdersGateway } from './modules/orders.gateway';
import { PlatformService } from './modules/platform.service';
import { PrismaService } from './prisma/prisma.service';
import { BenefitGateway, MockEmailProvider, MockPushProvider, TapGateway } from './providers/mock.providers';
import { createOtpProvider } from './providers/whatsapp.provider';

export function createContainer() {
  const prisma = new PrismaService();
  const jwt = new JwtService(process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me', '15m');
  const crypto = new CryptoService();
  const audit = new AuditService(prisma);
  const gateway = new OrdersGateway(jwt, prisma);
  const platform = new PlatformService(prisma, audit, crypto);
  const commerce = new CommerceService(prisma, new TapGateway(), new BenefitGateway(), new MockPushProvider(), gateway, platform);
  return {
    prisma,
    jwt,
    crypto,
    audit,
    gateway,
    platform,
    commerce,
    sms: createOtpProvider(),
    email: new MockEmailProvider(),
  };
}

export type Container = ReturnType<typeof createContainer>;
