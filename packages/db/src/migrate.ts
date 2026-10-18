/**
 * Применяет миграции Drizzle (DDL) и затем пост‑миграционный SQL из sql/*.sql:
 * расширения, гипертаблицы, continuous aggregates и политики TimescaleDB.
 * Файлы в sql/ идемпотентны и выполняются по одному выражению вне транзакции
 * (CREATE MATERIALIZED VIEW ... WITH (timescaledb.continuous) нельзя выполнять в транзакции).
 * Разделитель выражений: строка "-- >>>".
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { loadRootEnv, requireEnv } from "./env";

loadRootEnv();
const url = requireEnv("DATABASE_URL");
const here = import.meta.dirname;

const sql = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sql);

const started = Date.now();
console.info("[db] применяю миграции Drizzle…");
const migrationsFolder = process.env.DB_MIGRATIONS_DIR ?? resolve(here, "../drizzle");
await migrate(db, { migrationsFolder });

const sqlDir = process.env.DB_SQL_DIR ?? resolve(here, "../sql");
const files = readdirSync(sqlDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
for (const file of files) {
  const content = readFileSync(resolve(sqlDir, file), "utf8");
  const statements = content
    .split(/^-- >>>\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^(--[^\n]*\n?)+$/.test(s));
  console.info(`[db] ${file}: ${statements.length} выражений`);
  for (const statement of statements) {
    await sql.unsafe(statement);
  }
}

await sql.end();
console.info(`[db] готово за ${Date.now() - started} мс`);
