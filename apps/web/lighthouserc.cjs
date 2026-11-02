/**
 * Lighthouse CI (docs/04-delivery-plan.md, неделя 8): главная, страница станции и /weather
 * на production-сборке E2E (e2e/setup/server.mjs). Пороги: performance ≥ 80, accessibility ≥ 95,
 * SEO ≥ 90 (best-practices — предупреждение). Запуск: pnpm -C apps/web lhci
 * (нужен Chrome/Chromium: CHROME_PATH или установленный Google Chrome).
 *
 * Главная — карта MapLibre на весь экран, и для неё свои проверки (docs/perf.md). На раннере CI
 * нет GPU: Chrome собирает кадры программно и на каждом кадре карты синхронно читает пиксели
 * WebGL (GLES2::ReadPixels, 0,1–0,4 с), чего на телефонах с GPU не бывает. Поэтому для «/»
 * блокируют выкатку то, что от этого не зависит: первая отрисовка, сдвиги вёрстки, доступность,
 * SEO и нижняя граница performance от грубых регрессий; LCP и TBT по ТЗ — предупреждения. Объём
 * стартового JS главной (без MapLibre) проверяет E2E (e2e/public/home.spec.ts).
 */
const base = (process.env.LHCI_BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const reuseServer = process.env.LHCI_REUSE_SERVER === "1";
const common = {
  "categories:accessibility": ["error", { minScore: 0.95 }],
  "categories:seo": ["error", { minScore: 0.9 }],
  "categories:best-practices": ["warn", { minScore: 0.9 }],
};

module.exports = {
  ci: {
    collect: {
      url: [`${base}/`, `${base}/ru/air/stations/e2e-dushanbe-center`, `${base}/ru/weather`],
      numberOfRuns: Number(process.env.LHCI_RUNS ?? 3),
      ...(reuseServer
        ? {}
        : {
            startServerCommand: "node e2e/setup/server.mjs",
            startServerReadyPattern: "Ready in",
            startServerReadyTimeout: 420_000,
          }),
      settings: {
        // Мобильная эмуляция Lighthouse по умолчанию (медленные сети Таджикистана — целевой сценарий).
        chromeFlags: "--no-sandbox --headless=new",
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
        skipAudits: ["uses-http2"],
      },
    },
    assert: {
      assertMatrix: [
        {
          matchingUrlPattern: "^https?://[^/]+/?$",
          assertions: {
            ...common,
            "categories:performance": ["error", { minScore: 0.4 }],
            "first-contentful-paint": ["error", { maxNumericValue: 2500 }],
            "cumulative-layout-shift": ["error", { maxNumericValue: 0.1 }],
            // ТЗ: LCP ≤ 2,5 с на мобильном 4G (Lighthouse симулирует более медленный 4G).
            "largest-contentful-paint": ["warn", { maxNumericValue: 2500 }],
            "total-blocking-time": ["warn", { maxNumericValue: 600 }],
          },
        },
        {
          matchingUrlPattern: "^https?://[^/]+/.+",
          assertions: { ...common, "categories:performance": ["error", { minScore: 0.8 }] },
        },
      ],
    },
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci",
      reportFilenamePattern: "%%PATHNAME%%-%%DATETIME%%.report.%%EXTENSION%%",
    },
  },
};
