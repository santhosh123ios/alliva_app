import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'crypto';

@Injectable()
export class CryptoService {
  hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  random(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64url')}.${tag.toString('base64url')}.${encrypted.toString('base64url')}`;
  }

  decrypt(payload: string): string {
    const [iv, tag, data] = payload.split('.');
    if (!iv || !tag || !data) throw new Error('Invalid ciphertext');
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }

  private key(): Buffer {
    const raw = process.env.ENCRYPTION_KEY ?? 'alliva-dev-key';
    if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, 'hex');
    return scryptSync(raw, 'alliva-bank', 32);
  }
}

export function dec(value: { toFixed: (digits: number) => string } | null | undefined): string {
  if (!value) return '0.000';
  return value.toFixed(3);
}

export function loc(value: unknown): { en: string; ar: string } {
  const record = (value ?? {}) as { en?: string; ar?: string };
  return { en: record.en ?? '', ar: record.ar ?? '' };
}
