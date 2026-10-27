import { Logger } from '../common/logger';
import type { EmailProvider } from './interfaces';
import { MockEmailProvider } from './mock.providers';

export class ResendEmailProvider implements EmailProvider {
  private readonly logger = new Logger('Resend');

  async send(to: string, subject: string, text: string, html?: string): Promise<void> {
    const key = process.env.RESEND_API_KEY;
    const rawFrom = process.env.EMAIL_FROM || 'noreply@alliva.bh';
    const from = rawFrom.includes('<') ? rawFrom : `Alliva <${rawFrom}>`;
    if (!key) throw new Error('Resend is not configured');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ from, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      const detail = await response.text();
      this.logger.error(`Resend rejected ${to} (${response.status}): ${detail.slice(0, 500)}`);
      throw new Error(`Resend rejected the email (${response.status})`);
    }
    this.logger.log(`Sent "${subject}" to ${to}`);
  }
}

export function createEmailProvider(): EmailProvider {
  if (process.env.RESEND_API_KEY) return new ResendEmailProvider();
  return new MockEmailProvider();
}
