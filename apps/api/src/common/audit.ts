import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { EntitlementError } from '../domain/entitlements';
import { PrismaService } from '../prisma/prisma.service';

@Catch()
@Injectable()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof EntitlementError) {
      response.status(HttpStatus.BAD_REQUEST).json({ message: exception.message });
      return;
    }
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      response.status(exception.getStatus()).json(typeof body === 'string' ? { message: body } : body);
      return;
    }
    if (exception instanceof Error) {
      const business =
        /Cannot move|Promo|Order is|Plan |Commission|Driver statuses|role cannot|not active|not configured|budget|unavailable|Ledger|Merchant net|does not match/.test(
          exception.message,
        );
      if (business) {
        response.status(HttpStatus.BAD_REQUEST).json({ message: exception.message });
        return;
      }
      this.logger.error(exception.stack ?? exception.message);
    }
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: 'Something went wrong' });
  }
}

@Injectable()
export class AuditService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async log(input: {
    actorId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: unknown;
    ipAddress?: string | null;
  }) {
    await this.prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        metadata: input.metadata as object | undefined,
        ipAddress: input.ipAddress ?? null,
      },
    });
  }
}
