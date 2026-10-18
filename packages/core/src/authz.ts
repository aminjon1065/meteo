/**
 * Модель доступа на основе ролей (ТЗ, модуль 7):
 *  - admin    — полный доступ;
 *  - operator — ввод и контроль качества данных мониторинга;
 *  - editor   — только контент (новости, бюллетени).
 *
 * Матрица прав — единственный источник правды. Проверка выполняется на сервере
 * (server actions / route handlers) через can(); клиент использует её только для UI.
 */
export const roles = ["admin", "operator", "editor"] as const;
export type Role = (typeof roles)[number];

export const permissions = [
  "admin.access",
  "stations.read",
  "stations.write",
  "measurements.read",
  "measurements.write",
  "measurements.qc",
  "scales.write",
  "healthAdvice.write",
  "alerts.manage",
  "content.read",
  "content.write",
  "content.publish",
  "subscribers.manage",
  "users.manage",
  "audit.read",
  "settings.write",
] as const;
export type Permission = (typeof permissions)[number];

const matrix: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set(permissions),
  operator: new Set<Permission>([
    "admin.access",
    "stations.read",
    "measurements.read",
    "measurements.write",
    "measurements.qc",
    "content.read",
  ]),
  editor: new Set<Permission>([
    "admin.access",
    "stations.read",
    "content.read",
    "content.write",
    "content.publish",
  ]),
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (roles as readonly string[]).includes(value);
}

export function can(role: string | null | undefined, permission: Permission): boolean {
  if (!isRole(role)) return false;
  return matrix[role].has(permission);
}

export function permissionsOf(role: string | null | undefined): Permission[] {
  if (!isRole(role)) return [];
  return [...matrix[role]];
}

export class ForbiddenError extends Error {
  readonly permission: Permission;
  constructor(permission: Permission) {
    super(`Forbidden: ${permission}`);
    this.name = "ForbiddenError";
    this.permission = permission;
  }
}

/** Бросает ForbiddenError, если у роли нет права. Удобно в server actions. */
export function assertCan(role: string | null | undefined, permission: Permission): void {
  if (!can(role, permission)) throw new ForbiddenError(permission);
}
