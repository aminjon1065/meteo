import { resolve } from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Заголовки безопасности для всех ответов (страницы, API, статика). CSP с nonce и X-Frame-Options
 * ставит src/proxy.ts: они зависят от запроса (nonce) и пути (iframe-виджеты /embed/*).
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: resolve(import.meta.dirname, "../../"),
  transpilePackages: ["@meteo/ui", "@meteo/core", "@meteo/db", "@meteo/i18n"],
  serverExternalPackages: ["postgres", "ioredis", "bullmq"],
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
  },
  experimental: {
    // Импорт измерений (CSV/XLSX до 20 МБ) идёт через server action: лимит тела по умолчанию 1 МБ.
    serverActions: { bodySizeLimit: "25mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default withNextIntl(nextConfig);
