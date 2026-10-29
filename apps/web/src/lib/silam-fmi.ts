import "server-only";
import { type FmiSilamProduct, fmiSilamOrigin, fmiSilamUpstreamPath } from "@meteo/core/silam-fmi";
import { cachedJson } from "@/lib/cache";

/**
 * Карты SILAM для Таджикистана, которые рисует FMI (https://silam.fmi.fi/roux/TAJ/, страница
 * /air/silam). Браузер берёт кадры только с портала (CSP `img-src 'self'`): маршрут /silam-fmi
 * скачивает их у FMI, держит в памяти и отдаёт с долгим кэшем (адрес содержит прогон).
 * Адрес источника — SILAM_FMI_URL (пусто — сервер FMI); «off» — раздел без карт и без запросов к FMI.
 */
const DEFAULT_BASE = "https://silam.fmi.fi/roux/TAJ";
const TTL_SEC = 600;
const CATALOG_TIMEOUT_MS = 5000;
const FRAME_TIMEOUT_MS = 15_000;
/** После отказа FMI не спрашиваем минуту: страница не ждёт таймаут при каждом открытии. */
const RETRY_AFTER_MS = 60_000;
/** Кадр FMI — 30–50 КБ; больший ответ не принимаем. */
const MAX_FRAME_BYTES = 1_000_000;
/** Кэш кадров в памяти процесса: ~3 прогона × 8 показателей × 49 часов по 40 КБ. */
const MEMORY_BYTES = 48 * 1024 * 1024;

export interface FmiSilamCatalog {
  /** Начало последнего прогона (00 UTC). */
  originTime: string;
  /** Когда FMI выпустил картинки (Last-Modified). */
  issuedAt: string;
}

export function fmiSilamBaseUrl(): string | null {
  const raw = process.env.SILAM_FMI_URL?.trim() || DEFAULT_BASE;
  if (raw === "off") return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? raw.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

/** Дата выпуска из Last-Modified; null — заголовка нет или он нечитаем. */
function issuedAt(res: Response): Date | null {
  const raw = res.headers.get("last-modified");
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

let downUntil = 0;

async function fetchCatalog(base: string): Promise<FmiSilamCatalog> {
  // Первый кадр индекса AQI выходит вместе с остальными; по его Last-Modified определяется прогон.
  const res = await fetch(`${base}/000/AQI_000.png`, {
    method: "HEAD",
    signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`FMI SILAM: HTTP ${res.status}`);
  const issued = issuedAt(res);
  if (!issued) throw new Error("FMI SILAM: нет Last-Modified");
  return {
    originTime: fmiSilamOrigin(issued).toISOString(),
    issuedAt: issued.toISOString(),
  };
}

/**
 * Последний прогон FMI с кэшем 10 минут (FMI выпускает карты раз в сутки около 02:03 UTC).
 * Ошибка не кэшируется, но минуту после неё FMI не опрашивается: null — карты недоступны.
 */
export async function loadFmiSilamCatalog(): Promise<FmiSilamCatalog | null> {
  const base = fmiSilamBaseUrl();
  if (!base) return null;
  if (Date.now() < downUntil) return null;
  try {
    const { value } = await cachedJson("silam-fmi:catalog", TTL_SEC, () => fetchCatalog(base));
    return value;
  } catch (error) {
    downUntil = Date.now() + RETRY_AFTER_MS;
    console.warn("[silam-fmi] FMI недоступен:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** LRU по байтам: Map хранит порядок вставки, при чтении запись переносится в конец. */
const frames = new Map<string, Uint8Array>();
let framesBytes = 0;
const inflight = new Map<string, Promise<FrameResult>>();

function remember(key: string, body: Uint8Array): void {
  frames.set(key, body);
  framesBytes += body.byteLength;
  while (framesBytes > MEMORY_BYTES) {
    const oldest = frames.keys().next();
    if (oldest.done) break;
    framesBytes -= frames.get(oldest.value)?.byteLength ?? 0;
    frames.delete(oldest.value);
  }
}

export type FrameResult =
  | { status: "ok"; body: Uint8Array }
  /** У FMI сейчас другой прогон в этом каталоге (смена суток) или кадра нет. */
  | { status: "missing" }
  | { status: "error"; message: string };

async function fetchFrame(
  base: string,
  folder: number,
  product: FmiSilamProduct,
  hour: number,
  origin: Date,
): Promise<FrameResult> {
  let res: Response;
  try {
    res = await fetch(`${base}/${fmiSilamUpstreamPath(folder, product, hour)}`, {
      signal: AbortSignal.timeout(FRAME_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
  if (res.status === 404) {
    await res.body?.cancel().catch(() => undefined);
    return { status: "missing" };
  }
  const type = res.headers.get("content-type") ?? "";
  const length = Number(res.headers.get("content-length") ?? 0);
  if (!res.ok || !type.startsWith("image/png") || length > MAX_FRAME_BYTES) {
    await res.body?.cancel().catch(() => undefined);
    return { status: "error", message: `HTTP ${res.status} ${type}` };
  }
  const issued = issuedAt(res);
  if (!issued || fmiSilamOrigin(issued).getTime() !== origin.getTime()) {
    // Каталог уже занят другим прогоном: такой кадр нельзя отдавать под этим адресом.
    await res.body?.cancel().catch(() => undefined);
    return { status: "missing" };
  }
  const body = new Uint8Array(await res.arrayBuffer());
  if (body.byteLength > MAX_FRAME_BYTES) return { status: "error", message: "too large" };
  return { status: "ok", body };
}

/**
 * Кадр прогона `origin`: из памяти или у FMI. Каталог (`000`…`002`) вычисляется по последнему
 * прогону; если FMI успел выпустить новый, пока каталог ещё в кэше, кадр ищется на каталог дальше.
 */
export async function loadFmiSilamFrame(
  product: FmiSilamProduct,
  origin: Date,
  hour: number,
  folders: number[],
): Promise<FrameResult> {
  const base = fmiSilamBaseUrl();
  if (!base) return { status: "missing" };
  const key = `${origin.toISOString()}/${product.code}/${hour}`;
  const cached = frames.get(key);
  if (cached) {
    frames.delete(key);
    frames.set(key, cached);
    return { status: "ok", body: cached };
  }
  const pending = inflight.get(key);
  if (pending) return pending;
  const task = (async (): Promise<FrameResult> => {
    let last: FrameResult = { status: "missing" };
    for (const folder of folders) {
      last = await fetchFrame(base, folder, product, hour, origin);
      if (last.status === "ok") {
        remember(key, last.body);
        return last;
      }
      if (last.status === "error") return last;
    }
    return last;
  })().finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}
