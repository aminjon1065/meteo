import { describe, expect, it } from "vitest";
import {
  buildCsp,
  DEFAULT_EMBED_ANCESTORS,
  generateNonce,
  isEmbedPath,
  parseEmbedAncestors,
} from "@/lib/security/csp";

describe("isEmbedPath", () => {
  it("распознаёт виджеты с префиксом локали и без", () => {
    expect(isEmbedPath("/embed/aqi")).toBe(true);
    expect(isEmbedPath("/ru/embed/forecast")).toBe(true);
    expect(isEmbedPath("/en/embed")).toBe(true);
    expect(isEmbedPath("/embedded")).toBe(false);
    expect(isEmbedPath("/news/embed")).toBe(false);
    expect(isEmbedPath("/admin")).toBe(false);
  });
});

describe("parseEmbedAncestors", () => {
  it("по умолчанию — сайты Агентства", () => {
    expect(parseEmbedAncestors(undefined)).toEqual([...DEFAULT_EMBED_ANCESTORS]);
    expect(parseEmbedAncestors("")).toEqual([...DEFAULT_EMBED_ANCESTORS]);
  });
  it("принимает список через пробел/запятую, добавляет 'self' и отбрасывает мусор", () => {
    expect(parseEmbedAncestors("https://meteo.tj, https://*.gov.tj javascript:alert(1)")).toEqual([
      "'self'",
      "https://meteo.tj",
      "https://*.gov.tj",
    ]);
  });
});

describe("buildCsp", () => {
  const base = { nonce: "abc123", dev: false, embed: false, embedAncestors: ["'self'"] };

  it("скрипты только с nonce и strict-dynamic, без eval в production", () => {
    const csp = buildCsp(base);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("в разработке разрешает eval (React DevTools) и WebSocket HMR", () => {
    const csp = buildCsp({ ...base, dev: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("connect-src 'self' ws: wss:");
  });

  it("виджеты: frame-ancestors из настройки, на https — upgrade-insecure-requests", () => {
    const csp = buildCsp({
      ...base,
      embed: true,
      embedAncestors: ["'self'", "https://meteo.tj"],
      appUrl: "https://portal.meteo.tj",
    });
    expect(csp).toContain("frame-ancestors 'self' https://meteo.tj");
    expect(csp.endsWith("upgrade-insecure-requests")).toBe(true);
  });

  it("учитывает MapLibre и ECharts: data:/blob: картинки, worker same-origin, инлайн-стили", () => {
    const csp = buildCsp(base);
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });
});

describe("generateNonce", () => {
  it("даёт уникальные base64-строки длиной 24 символа", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(a).not.toBe(b);
  });
});
