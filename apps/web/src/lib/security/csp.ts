/**
 * Content Security Policy портала (docs/02-architecture.md §10, docs/security-checklist.md).
 *
 * Скрипты — только с nonce (+ 'strict-dynamic': чанки, которые подгружает Next.js, наследуют доверие).
 * Стили — 'unsafe-inline': React выводит `style=""` при SSR, MapLibre и ECharts задают стили из JS;
 * nonce для стилей не применим. Изображения data:/blob: нужны MapLibre (спрайты, растровые слои SILAM)
 * и next/image. Worker MapLibre лежит в /maplibre (same-origin), blob: оставлен для его fallback.
 * iframe-виджеты /embed/* могут встраиваться только сайтами Агентства (frame-ancestors).
 */
export interface CspOptions {
  nonce: string;
  /** Режим разработки: React/Turbopack используют eval и WebSocket HMR. */
  dev: boolean;
  /** Страница виджета (/embed/*): разрешаем встраивание в iframe перечисленным источникам. */
  embed: boolean;
  /** Источники, которым разрешено встраивать виджеты (frame-ancestors). */
  embedAncestors: readonly string[];
  /** Публичный адрес портала: при https добавляется upgrade-insecure-requests. */
  appUrl?: string;
}

export const DEFAULT_EMBED_ANCESTORS = [
  "'self'",
  "https://meteo.tj",
  "https://*.meteo.tj",
] as const;

const EMBED_PATH = /^(?:\/(?:tg|ru|en))?\/embed(?:\/|$)/;

/** Путь iframe-виджета: /embed/…, /ru/embed/…, /en/embed/… */
export function isEmbedPath(pathname: string): boolean {
  return EMBED_PATH.test(pathname);
}

/** Разбирает EMBED_FRAME_ANCESTORS ("https://meteo.tj https://*.meteo.tj") с дефолтом. */
export function parseEmbedAncestors(raw: string | undefined): string[] {
  const list = (raw ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => /^(?:'self'|https?:\/\/[A-Za-z0-9*.:-]+)$/.test(s));
  if (list.length === 0) return [...DEFAULT_EMBED_ANCESTORS];
  return list.includes("'self'") ? list : ["'self'", ...list];
}

export function buildCsp(opts: CspOptions): string {
  const scriptSrc = [`'self'`, `'nonce-${opts.nonce}'`, `'strict-dynamic'`];
  if (opts.dev) scriptSrc.push(`'unsafe-eval'`);
  const connectSrc = [`'self'`];
  if (opts.dev) connectSrc.push("ws:", "wss:");
  const directives: Array<[string, string[]]> = [
    ["default-src", [`'self'`]],
    ["script-src", scriptSrc],
    ["style-src", [`'self'`, `'unsafe-inline'`]],
    ["img-src", [`'self'`, "data:", "blob:"]],
    ["font-src", [`'self'`, "data:"]],
    ["connect-src", connectSrc],
    ["worker-src", [`'self'`, "blob:"]],
    ["media-src", [`'self'`]],
    ["manifest-src", [`'self'`]],
    ["object-src", [`'none'`]],
    ["base-uri", [`'self'`]],
    ["form-action", [`'self'`]],
    ["frame-src", opts.dev ? [`'self'`] : [`'none'`]],
    ["frame-ancestors", opts.embed ? [...opts.embedAncestors] : [`'none'`]],
  ];
  const parts = directives.map(([name, values]) => `${name} ${values.join(" ")}`);
  if (opts.appUrl?.startsWith("https://")) parts.push("upgrade-insecure-requests");
  return parts.join("; ");
}

/** Nonce: 128 бит случайности в base64 (Web Crypto доступен и в Node, и в Edge). */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}
