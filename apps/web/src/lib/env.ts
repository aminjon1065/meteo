import { z } from "zod";

const serverSchema = z.object({
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET должен быть не короче 32 символов"),
  BETTER_AUTH_URL: z.string().url().optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  REDIS_URL: z.string().optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

/** Ленивая валидация окружения: сборка не требует секретов, рантайм — требует. */
/** Пустые значения (`VAR=` в compose/.env) считаются незаданными. */
export function withoutEmptyValues(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
}

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(withoutEmptyValues(process.env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Некорректное окружение: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
