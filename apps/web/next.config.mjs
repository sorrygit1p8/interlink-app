import path from 'node:path';
import { fileURLToPath } from 'node:url';
const productionData = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../packages/data/src/production.ts');
const production = process.env.INTERLINK_APP_ENV === 'production';
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@interlink/shared', '@interlink/data'],
  poweredByHeader: false,
  devIndicators: false,
  turbopack: { resolveAlias: production ? { '@interlink/data': '@interlink/data/production' } : {} },
  webpack(config) {
    if (production) config.resolve.alias['@interlink/data$'] = productionData;
    return config;
  },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
      { key: 'Content-Security-Policy', value: `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'` },
    ] }];
  },
};
export default nextConfig;
