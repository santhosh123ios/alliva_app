export interface SmsProvider {
  sendOtp(phone: string, code: string): Promise<void>;
}

export interface EmailProvider {
  send(to: string, subject: string, text: string): Promise<void>;
}

export interface PushProvider {
  send(token: string, title: string, body: string): Promise<void>;
}

export interface StorageProvider {
  save(input: { filename: string; mimeType: string; bytes: Buffer }): Promise<{ url: string }>;
}

export interface MapsProvider {
  geocode(address: string): Promise<{ latitude: string; longitude: string } | null>;
}

export interface PaymentGateway {
  readonly name: 'TAP' | 'BENEFIT';
  createCharge(input: { amount: string; reference: string; method: string }): Promise<{ externalId: string; status: 'CAPTURED' | 'FAILED' }>;
  verifyWebhook(rawBody: Buffer, signature: string | undefined): boolean;
}

export const ALLOWED_UPLOAD_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
