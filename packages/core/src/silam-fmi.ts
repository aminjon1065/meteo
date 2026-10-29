/**
 * Карты SILAM, которые FMI строит для Таджикистана в рамках проекта FINTAJ
 * (https://silam.fmi.fi/roux/TAJ/): готовые PNG по показателям и часам, без чтения NetCDF.
 *
 * Как устроен каталог FMI (проверено 29.10.2026):
 * - `000/<файл>_<ччч>.png` — последний прогон, кадры через час, `000`…`048`;
 *   `001/`, `002/` — прогоны на сутки и на двое раньше (более старые каталоги FMI не обновляет);
 * - прогон начинается в 00 UTC суток, предшествующих дню выпуска: так FMI считает региональные
 *   прогнозы для Центральной Азии (48 ч от 00Z предыдущего дня), картинки выходят около 02:03 UTC;
 * - срока прогноза в файле нет (только дата создания), поэтому прогон определяется по Last-Modified.
 *
 * Здесь — чистые функции без сети: список показателей, адреса кадров, сроки. Сеть — в apps/web.
 */

export interface FmiSilamProduct {
  /** Код на портале (в адресах и переводах). */
  code: string;
  /** Имя файла у FMI без часа. */
  file: string;
  /** Размер картинки FMI, px: у AQI под картой индекса — карта определяющего вещества. */
  width: number;
  height: number;
}

/** Показатели в порядке FMI (так же у узбекской страницы data.meteo.uz). */
export const FMI_SILAM_PRODUCTS = [
  { code: "AQI", file: "AQI", width: 800, height: 1100 },
  { code: "CO", file: "CO_surf", width: 800, height: 600 },
  { code: "NO2", file: "NO2_surf", width: 800, height: 600 },
  { code: "O3", file: "O3_surf", width: 800, height: 600 },
  { code: "PM10", file: "PM10_surf", width: 800, height: 600 },
  { code: "PM25", file: "PM2_5_surf", width: 800, height: 600 },
  { code: "SO2", file: "SO2_surf", width: 800, height: 600 },
  { code: "ABL", file: "BLH", width: 800, height: 600 },
] as const satisfies readonly FmiSilamProduct[];

export type FmiSilamCode = (typeof FMI_SILAM_PRODUCTS)[number]["code"];

/** Граница между верхней (индекс) и нижней (определяющее вещество) картами на кадре AQI, px. */
export const FMI_SILAM_AQI_SPLIT = 570;

/** Последний час прогона: кадры 000…048. */
export const FMI_SILAM_LAST_HOUR = 48;
/** Каталоги, которые FMI обновляет: 000 (последний прогон), 001, 002. */
export const FMI_SILAM_FOLDERS = 3;

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export function fmiSilamProduct(code: string): (typeof FMI_SILAM_PRODUCTS)[number] | undefined {
  return FMI_SILAM_PRODUCTS.find((p) => p.code === code);
}

/** Начало прогона по времени выпуска файлов: 00 UTC суток, предшествующих дню выпуска (UTC). */
export function fmiSilamOrigin(issued: Date): Date {
  return new Date(Date.UTC(issued.getUTCFullYear(), issued.getUTCMonth(), issued.getUTCDate() - 1));
}

/** Идентификатор прогона в адресах портала: YYYYMMDD начала (00 UTC). */
export function fmiSilamRunId(origin: Date): string {
  return origin.toISOString().slice(0, 10).replaceAll("-", "");
}

/** Обратное к fmiSilamRunId; null — не дата. */
export function parseFmiSilamRunId(id: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(id);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d
    ? date
    : null;
}

/**
 * Каталог FMI с прогоном `origin`, если последний прогон — `latest`: 0 — `000`, 1 — `001`, 2 — `002`;
 * null — прогона уже (или ещё) нет у FMI.
 */
export function fmiSilamFolder(latest: Date, origin: Date): number | null {
  const days = Math.round((latest.getTime() - origin.getTime()) / DAY_MS);
  return days >= 0 && days < FMI_SILAM_FOLDERS ? days : null;
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}

/** Путь кадра у FMI относительно https://silam.fmi.fi/roux/TAJ: `000/PM10_surf_024.png`. */
export function fmiSilamUpstreamPath(
  folder: number,
  product: FmiSilamProduct,
  hour: number,
): string {
  return `${pad3(folder)}/${product.file}_${pad3(hour)}.png`;
}

/** Адрес кадра на портале (прокси apps/web/src/app/silam-fmi): `/silam-fmi/20261028/PM10/024.png`. */
export function fmiSilamFrameUrl(runId: string, code: string, hour: number): string {
  return `/silam-fmi/${runId}/${code}/${pad3(hour)}.png`;
}

/** Разбор адреса кадра портала; null — не наш кадр (неизвестный показатель, час вне 0…48). */
export function parseFmiSilamFramePath(segments: readonly string[]): {
  origin: Date;
  runId: string;
  product: (typeof FMI_SILAM_PRODUCTS)[number];
  hour: number;
} | null {
  if (segments.length !== 3) return null;
  const [runId, code, file] = segments as [string, string, string];
  const origin = parseFmiSilamRunId(runId);
  const product = fmiSilamProduct(code);
  const m = /^(\d{3})\.png$/.exec(file);
  if (!origin || !product || !m) return null;
  const hour = Number(m[1]);
  if (hour > FMI_SILAM_LAST_HOUR) return null;
  return { origin, runId, product, hour };
}

/** Срок кадра: начало прогона + час. */
export function fmiSilamFrameTime(origin: Date, hour: number): Date {
  return new Date(origin.getTime() + hour * HOUR_MS);
}

/** Кадр, ближайший к моменту `at` (в пределах 0…48). */
export function fmiSilamNearestHour(origin: Date, at: Date): number {
  const hour = Math.round((at.getTime() - origin.getTime()) / HOUR_MS);
  return Math.min(FMI_SILAM_LAST_HOUR, Math.max(0, hour));
}

/** Прогон устарел: FMI не выпускал новый дольше суток сверх обычного (начало старше 2 суток). */
export function fmiSilamIsStale(origin: Date, now: Date): boolean {
  return now.getTime() - origin.getTime() > 2 * DAY_MS + 12 * HOUR_MS;
}
