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
