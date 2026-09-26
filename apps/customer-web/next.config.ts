import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  agentRules: false,
  allowedDevOrigins: ['127.0.0.1'],
  transpilePackages: ['@alliva/ui', '@alliva/api-client', '@alliva/design-tokens', '@alliva/types', '@alliva/validation'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'}/api/:path*`,
      },
      {
        source: '/uploads/:path*',
        destination: `${process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000'}/uploads/:path*`,
      },
    ];
  },
};

export default withNextIntl(nextConfig);
