import "server-only";
import { randomUUID } from "node:crypto";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Каталог загрузок CMS: UPLOADS_DIR (в продакшене — том /app/uploads, раздаёт Caddy),
 * локально — data/uploads в корне монорепозитория. Файлы раздаёт /uploads/<путь>.
 */
export const UPLOADS_DIR = process.env.UPLOADS_DIR ?? resolve(process.cwd(), "../../data/uploads");

export const UPLOAD_PATH_RE = /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.(png|jpg|webp|gif|pdf)$/;

/** Сохраняет файл как {ГГГГ}/{ММ}/{uuid}.{ext} и возвращает относительный путь. */
export async function storeUpload(bytes: Uint8Array, ext: string): Promise<string> {
  const now = new Date();
  const rel = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${ext}`;
  // resolve + turbopackIgnore (как в /tiles и /silam): иначе Turbopack трассирует весь проект в standalone.
  const abs = resolve(UPLOADS_DIR, rel);
  mkdirSync(/* turbopackIgnore: true */ dirname(abs), { recursive: true });
  writeFileSync(/* turbopackIgnore: true */ abs, bytes);
  return rel;
}

export async function removeUpload(rel: string): Promise<void> {
  if (!UPLOAD_PATH_RE.test(rel)) return;
  try {
    const abs = resolve(UPLOADS_DIR, rel);
    unlinkSync(/* turbopackIgnore: true */ abs);
  } catch {
    // файла уже нет — не ошибка
  }
}

export function uploadUrl(rel: string): string {
  return `/uploads/${rel}`;
}
