import { serviceUnavailable } from '../common/errors';
import { Logger } from '../common/logger';
import type { SmsProvider } from './interfaces';
import { MockSmsProvider } from './mock.providers';
import { otpChannel, whatsappOtpBody, whatsappTemplateLanguage } from './whatsapp.otp';

export class WhatsAppOtpProvider implements SmsProvider {
  readonly channel = 'whatsapp' as const;
  private readonly logger = new Logger('WhatsAppOtp');

  async sendOtp(phone: string, code: string, locale?: string): Promise<void> {
    const token = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!token || !phoneNumberId) {
      throw serviceUnavailable('WhatsApp is not configured');
    }
    const version = process.env.WHATSAPP_GRAPH_VERSION ?? 'v23.0';
    const template = process.env.WHATSAPP_OTP_TEMPLATE ?? 'alliva_otp';
    const body = whatsappOtpBody({
      to: phone,
      code,
      template,
      language: whatsappTemplateLanguage(locale),
    });
    let response: Response;
    try {
      response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12_000),
      });
    } catch (error) {
      this.logger.error(`WhatsApp OTP request failed: ${error instanceof Error ? error.message : 'unknown'}`);
      throw serviceUnavailable('We could not send the WhatsApp code. Try again.');
    }
    if (!response.ok) {
      const detail = await response.text();
      this.logger.error(`WhatsApp OTP failed (${response.status}): ${detail.slice(0, 500)}`);
      throw serviceUnavailable('We could not send the WhatsApp code. Try again.');
    }
  }
}

export class UnconfiguredOtpProvider implements SmsProvider {
  readonly channel = 'whatsapp' as const;
  async sendOtp(): Promise<void> {
    throw serviceUnavailable('WhatsApp is not configured');
  }
}

export function createOtpProvider(): SmsProvider {
  const channel = otpChannel();
  if (channel === 'whatsapp') return new WhatsAppOtpProvider();
  if (channel === 'unconfigured') return new UnconfiguredOtpProvider();
  return new MockSmsProvider();
}
