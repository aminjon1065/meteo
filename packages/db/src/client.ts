import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export interface DbOptions {
  /** Размер пула соединений (web: 10, worker: 5, миграции: 1). */
  max?: number;
  /** Отключать подготовленные выражения (нужно за PgBouncer в transaction‑режиме). */
  prepare?: boolean;
}

export function createDb(url: string, options: DbOptions = {}) {
  const client = postgres(url, {
    max: options.max ?? 10,
    prepare: options.prepare ?? true,
    onnotice: () => {},
  });
  const db = drizzle(client, { schema });
  return Object.assign(db, { $client: client });
}

export type Database = ReturnType<typeof createDb>;
export { schema };
