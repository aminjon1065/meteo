import { createDb, type Database } from "@meteo/db";
import { resolveE2eEnv } from "../setup/env.mjs";

let db: Database | null = null;

/** Соединение с базой E2E из тестов (проверка побочных эффектов: письма, флаги QC, подписки). */
export function e2eDb(): Database {
  if (!db) db = createDb(resolveE2eEnv().databaseUrl, { max: 2 });
  return db;
}

export async function closeE2eDb(): Promise<void> {
  if (db) {
    await db.$client.end();
    db = null;
  }
}
