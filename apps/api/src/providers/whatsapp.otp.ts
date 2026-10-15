import { randomInt } from 'crypto';

export function numericOtp(length = 6): string {
  return randomInt(0, 10 ** length)
    .toString()
    .padStart(length, '0');
}

export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

export type OtpChannel = 'whatsapp' | 'dev' | 'unconfigured';

export function otpChannel(): OtpChannel {
  if (whatsappConfigured()) return 'whatsapp';
  if (process.env.NODE_ENV === 'production') return 'unconfigured';
  return 'dev';
}

export function whatsappTemplateLanguage(locale?: string): string {
  if (locale === 'ar') return process.env.WHATSAPP_TEMPLATE_LANGUAGE_AR ?? 'ar';
  return process.env.WHATSAPP_TEMPLATE_LANGUAGE ?? 'en';
}

export function whatsappOtpBody(input: { to: string; code: string; template: string; language: string }) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: input.to.replace(/\D/g, ''),
    type: 'template',
    template: {
      name: input.template,
      language: { code: input.language },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: input.code }] },
        {
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: input.code }],
        },
      ],
    },
  };
}
