/**
 * Хранение учётных данных источников станций (station_sources): AES‑256‑GCM с ключом из
 * `STATION_SOURCES_KEY` (или `BETTER_AUTH_SECRET`). Формат `enc:v1:<iv>.<tag>.<data>` (base64url).
 * Значение `env:ИМЯ` ссылается на переменную окружения worker'а — для тех, кто не хочет хранить
 * секреты в БД даже зашифрованными. Только Node (node:crypto) — подпуть `@meteo/core/secret-box`.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const ENV_PREFIX = "env:";

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function isSealedSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(PREFIX);
}

export function isEnvSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(ENV_PREFIX);
}

/** Шифрует строку ключом; каждый вызов даёт новый IV. */
export function sealSecret(plain: string, secret: string): string {
  if (!secret || secret.length < 16) throw new Error("Ключ шифрования короче 16 символов");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${data.toString("base64url")}`;
}

export function openSecret(sealed: string, secret: string): string {
  if (!isSealedSecret(sealed)) throw new Error("Значение не зашифровано (нет префикса enc:v1:)");
  const [ivB64, tagB64, dataB64] = sealed.slice(PREFIX.length).split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Повреждённый формат зашифрованного значения");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(secret),
    Buffer.from(ivB64, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error(
      "Не удалось расшифровать: ключ STATION_SOURCES_KEY/BETTER_AUTH_SECRET изменился",
    );
  }
}

/**
 * Значение секрета для использования: `env:ИМЯ` → из окружения (отсутствие — ошибка),
 * `enc:v1:…` → расшифровка, иначе — как есть (значение, сохранённое без ключа шифрования).
 */
export function resolveStoredSecret(
  stored: string | null | undefined,
  secret: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (!stored) return null;
  if (isEnvSecret(stored)) {
    const name = stored.slice(ENV_PREFIX.length).trim();
    const value = env[name];
    if (value === undefined || value === "")
      throw new Error(`Переменная окружения ${name} для учётных данных источника не задана`);
    return value;
  }
  if (isSealedSecret(stored)) {
    if (!secret)
      throw new Error("Не задан ключ шифрования STATION_SOURCES_KEY (или BETTER_AUTH_SECRET)");
    return openSecret(stored, secret);
  }
  return stored;
}

/** Ключ шифрования из окружения: STATION_SOURCES_KEY, иначе BETTER_AUTH_SECRET. */
export function secretKeyFromEnv(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return env.STATION_SOURCES_KEY || env.BETTER_AUTH_SECRET || null;
}
