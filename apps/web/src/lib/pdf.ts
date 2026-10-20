import "server-only";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/**
 * PDF из HTML через Chromium Playwright, если пакет @playwright/test установлен (разработка, E2E,
 * сборка документации — тот же механизм, что docs/manuals/build.mjs). В production‑образе web
 * devDependencies нет: функция возвращает null, и вызывающий код отдаёт печатную HTML‑версию
 * (пользователь сохраняет PDF из диалога печати). Экземпляр браузера переиспользуется и
 * закрывается через минуту простоя.
 */
interface PdfPage {
  setContent(html: string, options?: { waitUntil?: "load" }): Promise<void>;
  emulateMedia(options: { media: "print" | "screen" }): Promise<void>;
  pdf(options: Record<string, unknown>): Promise<Uint8Array>;
  close(): Promise<void>;
}
interface PdfBrowser {
  newPage(): Promise<PdfPage>;
  close(): Promise<void>;
}
interface Chromium {
  launch(options?: Record<string, unknown>): Promise<PdfBrowser>;
}

const IDLE_MS = 60_000;
const globalRef = globalThis as unknown as {
  __meteoPdfBrowser?: Promise<PdfBrowser | null>;
  __meteoPdfTimer?: ReturnType<typeof setTimeout>;
};

function loadChromium(): Chromium | null {
  try {
    // Разрешение от package.json текущего процесса: apps/web в разработке и E2E; в standalone‑образе
    // пакета нет — require бросает, и PDF недоступен. turbopackIgnore: не трассировать в сборку.
    const require = createRequire(resolve(process.cwd(), "package.json"));
    const mod = require(/* turbopackIgnore: true */ "@playwright/test") as { chromium?: Chromium };
    return mod.chromium ?? null;
  } catch {
    return null;
  }
}

function browser(): Promise<PdfBrowser | null> {
  if (!globalRef.__meteoPdfBrowser) {
    globalRef.__meteoPdfBrowser = (async () => {
      const chromium = loadChromium();
      if (!chromium) return null;
      try {
        return await chromium.launch();
      } catch (error) {
        console.warn("[pdf] Chromium недоступен:", (error as Error).message.split("\n")[0]);
        return null;
      }
    })();
  }
  return globalRef.__meteoPdfBrowser;
}

function scheduleClose(): void {
  if (globalRef.__meteoPdfTimer) clearTimeout(globalRef.__meteoPdfTimer);
  globalRef.__meteoPdfTimer = setTimeout(() => {
    const pending = globalRef.__meteoPdfBrowser;
    globalRef.__meteoPdfBrowser = undefined;
    void pending?.then((b) => b?.close()).catch(() => undefined);
  }, IDLE_MS);
  globalRef.__meteoPdfTimer.unref?.();
}

/** Есть ли на сервере Chromium для PDF (для подсказки в интерфейсе). */
export async function pdfAvailable(): Promise<boolean> {
  const b = await browser();
  if (!b) globalRef.__meteoPdfBrowser = undefined;
  scheduleClose();
  return b !== null;
}

/** HTML‑страница (со стилями печати) → PDF A4; null — Chromium недоступен. */
export async function htmlToPdf(html: string): Promise<Uint8Array | null> {
  const b = await browser();
  if (!b) {
    globalRef.__meteoPdfBrowser = undefined;
    return null;
  }
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    const bytes = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    return new Uint8Array(bytes);
  } finally {
    await page.close().catch(() => undefined);
    scheduleClose();
  }
}
