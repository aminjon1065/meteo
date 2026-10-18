import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

/** Загружает .env из корня монорепозитория (если переменные ещё не заданы окружением). */
export function loadRootEnv(): void {
  loadEnv({ path: resolve(import.meta.dirname, "../../../.env"), quiet: true });
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Переменная окружения ${name} не задана`);
  }
  return value;
}
