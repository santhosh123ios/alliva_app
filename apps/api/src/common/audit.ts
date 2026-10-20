import type { NextFunction, Request, Response } from 'express';
import { EntitlementError } from '../domain/entitlements';
import type { PrismaService } from '../prisma/prisma.service';
import { HttpError } from './errors';
import { Logger } from './logger';

const logger = new Logger('ExceptionsHandler');

export function errorHandler(exception: unknown, _request: Request, response: Response, next: NextFunction) {
  if (response.headersSent) return next(exception);
  if (exception instanceof EntitlementError) {
    response.status(400).json({ message: exception.message });
    return;
  }
  if (exception instanceof HttpError) {
    response.status(exception.status).json(exception.body);
    return;
  }
  const parse = exception as { type?: string; status?: number; message?: string };
  if (parse?.type === 'entity.parse.failed' || parse?.type === 'entity.too.large') {
    const status = parse.status ?? 400;
    response.status(status).json({ message: parse.message, error: status === 413 ? 'Payload Too Large' : 'Bad Request', statusCode: status });
    return;
  }
  if (exception instanceof Error) {
    const business =
      /Cannot move|Promo|Order is|Plan |Commission|Driver statuses|role cannot|not active|not configured|budget|unavailable|Ledger|Merchant net|does not match/.test(
        exception.message,
      );
    if (business) {
      response.status(400).json({ message: exception.message });
      return;
    }
    logger.error(exception.stack ?? exception.message);
  }
  response.status(500).json({ message: 'Something went wrong' });
}

export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

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
