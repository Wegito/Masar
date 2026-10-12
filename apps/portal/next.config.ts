import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** Ziel der Rewrites auf /api (in Produktion leitet Caddy /api direkt an die API). */
const apiOrigin = process.env.API_INTERNAL_URL ?? 'http://localhost:3001';

/** Die Content-Security-Policy mit Nonce setzt src/proxy.ts je Anfrage. */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@masar/shared'],
  rewrites: () =>
    Promise.resolve([{ source: '/api/:path*', destination: `${apiOrigin}/api/:path*` }]),
  headers: () => Promise.resolve([{ source: '/:path*', headers: securityHeaders }]),
};

export default withNextIntl(config);
