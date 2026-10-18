/**
 * Ошибки PostgreSQL в server actions. Drizzle 0.45 оборачивает ошибку драйвера в DrizzleQueryError,
 * поэтому код SQLSTATE и имя ограничения ищем и в самой ошибке, и в `cause`.
 */
interface PgErrorShape {
  code?: unknown;
  constraint_name?: unknown;
  cause?: unknown;
}

function pgError(error: unknown, depth = 0): PgErrorShape | null {
  if (!error || typeof error !== "object" || depth > 3) return null;
  const e = error as PgErrorShape;
  if (typeof e.code === "string") return e;
  return pgError(e.cause, depth + 1);
}

/** Нарушение уникальности (SQLSTATE 23505): дубликат кода, slug, e-mail. */
export function isUniqueViolation(error: unknown): boolean {
  return pgError(error)?.code === "23505";
}

/** Имя нарушенного ограничения (например, stations_slug_unique) или null. */
export function violatedConstraint(error: unknown): string | null {
  const name = pgError(error)?.constraint_name;
  return typeof name === "string" ? name : null;
}
