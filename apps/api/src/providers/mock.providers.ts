import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import type { EmailProvider, MapsProvider, PaymentGateway, PushProvider, SmsProvider, StorageProvider } from './interfaces';

@Injectable()
export class MockSmsProvider implements SmsProvider {
  private readonly logger = new Logger('SmsProvider');
  async sendOtp(phone: string, code: string): Promise<void> {
    this.logger.log(`OTP for ${phone}: ${code}`);
  }
}

@Injectable()
export class MockEmailProvider implements EmailProvider {
  private readonly logger = new Logger('EmailProvider');
  async send(to: string, subject: string, text: string): Promise<void> {
    this.logger.log(`Email to ${to}: ${subject} — ${text}`);
  }
}

@Injectable()
export class MockPushProvider implements PushProvider {
  private readonly logger = new Logger('PushProvider');
  async send(token: string, title: string, body: string): Promise<void> {
    this.logger.log(`Push ${token}: ${title} — ${body}`);
  }
}

@Injectable()
export class LocalStorageProvider implements StorageProvider {
  async save(input: { filename: string; mimeType: string; bytes: Buffer }): Promise<{ url: string }> {
    const dir = process.env.UPLOAD_DIR ?? 'uploads';
    await mkdir(dir, { recursive: true });
    const safe = `${Date.now()}-${input.filename.replace(/[^a-zA-Z0-9._-]/g, '')}`;
    await writeFile(join(dir, safe), input.bytes);
    return { url: `/uploads/${safe}` };
  }
}

@Injectable()
export class S3StorageProvider implements StorageProvider {
  async save(input: { filename: string; mimeType: string; bytes: Buffer }): Promise<{ url: string }> {
    const endpoint = process.env.S3_ENDPOINT;
    const bucket = process.env.S3_BUCKET ?? 'alliva';
    if (!endpoint || !process.env.S3_ACCESS_KEY) {
      const local = new LocalStorageProvider();
      return local.save(input);
    }
    const key = `${Date.now()}-${input.filename.replace(/[^a-zA-Z0-9._-]/g, '')}`;
    const response = await fetch(`${endpoint}/${bucket}/${key}`, {
      method: 'PUT',
      headers: {
        'Content-Type': input.mimeType,
        'Content-Length': String(input.bytes.length),
      },
      body: new Uint8Array(input.bytes),
    });
    if (!response.ok) {
      const local = new LocalStorageProvider();
      return local.save(input);
    }
    return { url: `${endpoint}/${bucket}/${key}` };
  }
}

@Injectable()
export class MockMapsProvider implements MapsProvider {
  async geocode(): Promise<{ latitude: string; longitude: string } | null> {
    if (!process.env.GOOGLE_MAPS_API_KEY) return { latitude: '26.228500', longitude: '50.586000' };
    return { latitude: '26.228500', longitude: '50.586000' };
  }
}

function verify(secret: string, rawBody: Buffer, signature: string | undefined): boolean {
  if (!signature) return false;
  const digest = createHmac('sha256', secret).update(rawBody).digest('hex');
  const left = Buffer.from(digest);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
}

@Injectable()
export class TapGateway implements PaymentGateway {
  readonly name = 'TAP' as const;
  async createCharge(input: { amount: string; reference: string; method: string }) {
    return { externalId: `tap_${input.reference}`, status: 'CAPTURED' as const };
  }
  verifyWebhook(rawBody: Buffer, signature: string | undefined) {
    return verify(process.env.TAP_WEBHOOK_SECRET ?? 'dev-tap-secret', rawBody, signature);
  }
}

@Injectable()
export class BenefitGateway implements PaymentGateway {
  readonly name = 'BENEFIT' as const;
  async createCharge(input: { amount: string; reference: string; method: string }) {
    return { externalId: `benefit_${input.reference}`, status: 'CAPTURED' as const };
  }
  verifyWebhook(rawBody: Buffer, signature: string | undefined) {
    return verify(process.env.BENEFIT_WEBHOOK_SECRET ?? 'dev-benefit-secret', rawBody, signature);
  }
}

export function extensionFor(mime: string): string {
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'application/pdf') return '.pdf';
  return extname(mime);
}
