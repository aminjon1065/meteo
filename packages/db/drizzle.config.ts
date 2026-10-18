import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit транспилирует конфиг в CJS: import.meta.dirname там недоступен, поэтому cwd пакета.
loadEnv({ path: resolve(process.cwd(), "../../.env"), quiet: true });

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://meteo:meteo@localhost:5432/meteo",
  },
  strict: true,
  verbose: true,
});
