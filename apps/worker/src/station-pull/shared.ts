/**
 * Общие части адаптеров источников станций (файлы SFTP/FTP/HTTP и JSON API): расшифровка
 * учётных данных, заголовки авторизации HTTP, типы результата и ограничения сводки.
 */
import { resolveStoredSecret, secretKeyFromEnv } from "@meteo/core/secret-box";
import type { StationSourceWithStation } from "@meteo/db";
import { env } from "../env";

export const MAX_SUMMARY_ERRORS = 20;

export interface PullSourceOptions {
  now?: Date;
  /** Ручной запуск: обработать источник, даже если он выключен, и перечитать самый свежий файл / весь ответ. */
  force?: boolean;
}

export interface PullSourceResult {
  sourceId: number;
  stationCode: string;
  status: "ok" | "failed" | "skipped";
  /** Обработано файлов (файловые источники) или HTTP‑запросов (JSON API). */
  files: number;
  accepted: number;
  rejected: number;
  error?: string;
}

/** Пароль/токен и приватный ключ источника в открытом виде (enc:v1 → ключом worker'а, env:ИМЯ → из окружения). */
export function resolveSourceSecrets(source: StationSourceWithStation): {
  password: string | null;
  privateKey: string | null;
} {
  const key = secretKeyFromEnv({
    STATION_SOURCES_KEY: env.STATION_SOURCES_KEY,
    BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
  });
  return {
    password: resolveStoredSecret(source.secret, key, process.env),
    privateKey: resolveStoredSecret(source.privateKey, key, process.env),
  };
}

export const USER_AGENT = "meteoportal-worker/0.1 (+meteo.tj; station-pull)";

/** Заголовки HTTP‑запроса: Basic при логине и пароле, Bearer при одном токене. */
export function httpHeaders(
  username: string | null,
  password: string | null,
  accept: string,
): Record<string, string> {
  const headers: Record<string, string> = { "user-agent": USER_AGENT, accept };
  if (username && password) {
    headers.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  } else if (password) {
    headers.authorization = `Bearer ${password}`;
  }
  return headers;
}
