/**
 * Локальное время Таджикистана: UTC+5 без перехода на летнее время (с 1991 г.).
 * Для ввода проб оператор указывает местные дату и время; в БД храним UTC.
 */
export const DUSHANBE_OFFSET_MINUTES = 5 * 60;
export const DUSHANBE_TZ = "Asia/Dushanbe";

/** "2026-10-16" + "07:00" (местное) → Date (UTC). */
export function dushanbeLocalToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (
    !y ||
    !m ||
    !d ||
    hh === undefined ||
    Number.isNaN(hh) ||
    mm === undefined ||
    Number.isNaN(mm)
  ) {
    throw new Error(`Некорректные дата/время: ${date} ${time}`);
  }
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - DUSHANBE_OFFSET_MINUTES * 60_000);
}

/** Date (UTC) → { date: "YYYY-MM-DD", time: "HH:MM" } по местному времени Душанбе. */
export function utcToDushanbeLocal(at: Date): { date: string; time: string } {
  const shifted = new Date(at.getTime() + DUSHANBE_OFFSET_MINUTES * 60_000);
  const date = shifted.toISOString().slice(0, 10);
  const time = shifted.toISOString().slice(11, 16);
  return { date, time };
}

/** Стандартные сроки отбора разовых проб на постах наблюдений (местное время). */
export const DISCRETE_SAMPLE_TIMES = ["01:00", "07:00", "13:00", "19:00"] as const;

/** Разбирает ISO‑строку или "YYYY-MM-DD HH:MM" (считается местным временем). */
export function parseMeasurementTime(raw: string): Date | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s.replace(" ", "T"));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?$/);
  if (m?.[1] && m[2]) {
    try {
      return dushanbeLocalToUtc(m[1], m[2]);
    } catch {
      return null;
    }
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
