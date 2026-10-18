import "server-only";
import { createDb, type Database } from "@meteo/db";
import { env } from "./env";

const globalRef = globalThis as unknown as { __meteoDb?: Database };

/** Единственный пул соединений на процесс (переживает HMR в dev). */
export function getDb(): Database {
  if (!globalRef.__meteoDb) {
    globalRef.__meteoDb = createDb(env().DATABASE_URL, { max: 10 });
  }
  return globalRef.__meteoDb;
}
