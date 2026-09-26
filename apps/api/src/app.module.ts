import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, Reflector } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AllExceptionsFilter, AuditService } from './common/audit';
import { AuthGuard, CsrfGuard, PermissionsGuard } from './common/http';
import { CryptoService } from './common/crypto';
import { AuthController } from './modules/auth.controller';
import { CommerceService } from './modules/commerce.service';
import { OrdersGateway } from './modules/orders.gateway';
import { PlatformService } from './modules/platform.service';
import { PortalController } from './modules/portal.controller';
import { StorefrontController } from './modules/storefront.controller';
import { PrismaModule } from './prisma/prisma.module';
import { BenefitGateway, MockEmailProvider, MockPushProvider, MockSmsProvider, TapGateway } from './providers/mock.providers';

@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me',
      signOptions: { expiresIn: '15m' },
    }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 300 }]),
    PrismaModule,
  ],
  controllers: [AuthController, StorefrontController, PortalController],
  providers: [
    // @nestjs/core is ESM. CJS consumers such as ThrottlerGuard receive a
    // different Reflector class than the one Nest registers internally.
    Reflector,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    AuditService,
    CryptoService,
    CommerceService,
    PlatformService,
    OrdersGateway,
    MockSmsProvider,
    MockEmailProvider,
    MockPushProvider,
    TapGateway,
    BenefitGateway,
  ],
})
export class AppModule {}
