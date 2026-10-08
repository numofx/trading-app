import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === "development";
const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  compress: true,
  // ISR cache duration (stale-while-revalidate)
  expireTime: 3600, // 1 hour
  poweredByHeader: false,
  reactCompiler: true,
  reactStrictMode: true,
  skipTrailingSlashRedirect: true,
  typedRoutes: true,
  compiler: {
    removeConsole: !isDevelopment,
  },
  // Image optimization
  images: {
    formats: ["image/webp"],
    minimumCacheTTL: 14_400, // 4 hours
    remotePatterns: [
      // Whitelist external domains for Next.js Image optimization
      // Required for images from CDNs, CMSs, or third-party services
      // Use "**" prefix for all subdomains (e.g., "**.example.com")
      // {
      //   protocol: "https",
      //   hostname: "**.example.com",
      // },
    ],
  },
  logging: {
    fetches: {
      fullUrl: isDevelopment,
      hmrRefreshes: isDevelopment,
    },
  },
  /**
   * The routes the terminal had until 2026-10-08. Both markets now render at `/trade/<slug>`
   * (`lib/market-routes.ts`; this file cannot import it, so `lib/market-routes.test.mjs` pins the
   * two together). Temporary (307) until the slugs are final: a 308 is cached by browsers for
   * good. Next carries the query string over on its own. The matcher is case-insensitive, so
   * `/PERP` lands here too; a `/trade/<slug>` in another casing is redirected by the page.
   */
  async redirects() {
    return [
      { destination: "/trade/cngn-usdc", permanent: false, source: "/" },
      { destination: "/trade/cngn-perp", permanent: false, source: "/perp" },
    ];
  },
  async rewrites() {
    return [
      {
        destination: "https://us-assets.i.posthog.com/static/:path*",
        source: "/ingest/static/:path*",
      },
      {
        destination: "https://us-assets.i.posthog.com/array/:path*",
        source: "/ingest/array/:path*",
      },
      {
        destination: "https://us.i.posthog.com/:path*",
        source: "/ingest/:path*",
      },
    ];
  },
  turbopack: {
    root: join(projectRoot),
  },
};

export default nextConfig;
