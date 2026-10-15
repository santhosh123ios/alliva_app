import { numericOtp, otpChannel, whatsappConfigured, whatsappOtpBody, whatsappTemplateLanguage } from './whatsapp.otp';

describe('whatsapp otp', () => {
  const previous = {
    token: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    nodeEnv: process.env.NODE_ENV,
    language: process.env.WHATSAPP_TEMPLATE_LANGUAGE,
    languageAr: process.env.WHATSAPP_TEMPLATE_LANGUAGE_AR,
  };

  afterEach(() => {
    process.env.WHATSAPP_ACCESS_TOKEN = previous.token;
    process.env.WHATSAPP_PHONE_NUMBER_ID = previous.phoneId;
    process.env.NODE_ENV = previous.nodeEnv;
    process.env.WHATSAPP_TEMPLATE_LANGUAGE = previous.language;
    process.env.WHATSAPP_TEMPLATE_LANGUAGE_AR = previous.languageAr;
  });

  it('builds a copy-code authentication template for a Bahrain number', () => {
    expect(
      whatsappOtpBody({ to: '+97336000001', code: '482913', template: 'alliva_otp', language: 'en' }),
    ).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '97336000001',
      type: 'template',
      template: {
        name: 'alliva_otp',
        language: { code: 'en' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: '482913' }] },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: '482913' }],
          },
        ],
      },
    });
  });

  it('picks the Arabic template language', () => {
    process.env.WHATSAPP_TEMPLATE_LANGUAGE = 'en';
    process.env.WHATSAPP_TEMPLATE_LANGUAGE_AR = 'ar';
    expect(whatsappTemplateLanguage('ar')).toBe('ar');
    expect(whatsappTemplateLanguage('en')).toBe('en');
  });

  it('generates a six-digit code', () => {
    expect(numericOtp()).toMatch(/^\d{6}$/);
  });

  it('uses the development sender until WhatsApp credentials are set', () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    process.env.NODE_ENV = 'development';
    expect(whatsappConfigured()).toBe(false);
    expect(otpChannel()).toBe('dev');
  });

  it('refuses a fixed development code in production', () => {
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    process.env.NODE_ENV = 'production';
    expect(otpChannel()).toBe('unconfigured');
  });
});
