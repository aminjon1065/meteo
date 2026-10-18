/**
 * Lighthouse CI (docs/04-delivery-plan.md, неделя 8): главная, страница станции и /weather
 * на production-сборке E2E (e2e/setup/server.mjs). Пороги: performance ≥ 80, accessibility ≥ 95,
 * SEO ≥ 90 (best-practices — предупреждение). Запуск: pnpm -C apps/web lhci
 * (нужен Chrome/Chromium: CHROME_PATH или установленный Google Chrome).
 */
const base = (process.env.LHCI_BASE_URL ?? "http://localhost:3100").replace(/\/$/, "");
const reuseServer = process.env.LHCI_REUSE_SERVER === "1";

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
      assertions: {
        "categories:performance": ["error", { minScore: 0.8 }],
        "categories:accessibility": ["error", { minScore: 0.95 }],
        "categories:seo": ["error", { minScore: 0.9 }],
        "categories:best-practices": ["warn", { minScore: 0.9 }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: ".lighthouseci",
      reportFilenamePattern: "%%PATHNAME%%-%%DATETIME%%.report.%%EXTENSION%%",
    },
  },
};
