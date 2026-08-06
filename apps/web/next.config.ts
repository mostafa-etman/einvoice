import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  transpilePackages: ['@einvoice/shared', '@einvoice/eta-core'],
  // Docker production image uses `node server.js` from the standalone output.
  output: 'standalone',
};

export default withNextIntl(nextConfig);
