import { describe, expect, it } from "vitest";
import {
  assertCan,
  can,
  ForbiddenError,
  isRole,
  type Permission,
  permissions,
  permissionsOf,
  type Role,
  roles,
} from "../authz";

/**
 * Ожидаемая матрица прав (ТЗ, FR7.1) — записана явно: любое изменение прав роли должно
 * сопровождаться правкой этой таблицы, а не происходить незаметно.
 * operator — ввод и QC данных + экобюллетень; editor — контент + экобюллетень.
 */
const EXPECTED: Record<Exclude<Role, "admin">, Permission[]> = {
  operator: [
    "admin.access",
    "stations.read",
    "measurements.read",
    "measurements.write",
    "measurements.qc",
    "content.read",
    "ecoBulletin.read",
    "ecoBulletin.write",
    "ecoBulletin.publish",
  ],
  editor: [
    "admin.access",
    "stations.read",
    "content.read",
    "content.write",
    "content.publish",
    "ecoBulletin.read",
    "ecoBulletin.write",
    "ecoBulletin.publish",
  ],
};

/** Права, которые есть только у администратора. */
const ADMIN_ONLY: Permission[] = [
  "stations.write",
  "qcRules.write",
  "scales.write",
  "healthAdvice.write",
  "alerts.manage",
  "subscribers.manage",
  "users.manage",
  "audit.read",
  "settings.write",
];

describe("матрица прав (FR7.1)", () => {
  it("администратор может всё", () => {
    for (const p of permissions) expect(can("admin", p)).toBe(true);
    expect(permissionsOf("admin").sort()).toEqual([...permissions].sort());
  });

  for (const role of ["operator", "editor"] as const) {
    it(`${role}: ровно ожидаемые права, остальное запрещено`, () => {
      expect(permissionsOf(role).sort()).toEqual([...EXPECTED[role]].sort());
      for (const p of permissions) expect(can(role, p)).toBe(EXPECTED[role].includes(p));
    });
  }

  it("права только администратора недоступны оператору и редактору", () => {
    for (const p of ADMIN_ONLY) {
      expect(can("operator", p)).toBe(false);
      expect(can("editor", p)).toBe(false);
    }
  });

  it("оператор не правит контент, редактор не вводит данные", () => {
    expect(can("operator", "content.write")).toBe(false);
    expect(can("operator", "content.publish")).toBe(false);
    expect(can("editor", "measurements.write")).toBe(false);
    expect(can("editor", "measurements.qc")).toBe(false);
  });

  it("неизвестная или пустая роль не получает ничего", () => {
    for (const role of [null, undefined, "", "user", "ADMIN", "root"]) {
      expect(isRole(role)).toBe(false);
      expect(permissionsOf(role)).toEqual([]);
      for (const p of permissions) expect(can(role, p)).toBe(false);
    }
    expect(roles).toEqual(["admin", "operator", "editor"]);
  });

  it("assertCan бросает ForbiddenError с названием права", () => {
    expect(() => assertCan("operator", "measurements.write")).not.toThrow();
    try {
      assertCan("editor", "users.manage");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenError);
      expect((error as ForbiddenError).permission).toBe("users.manage");
    }
  });
});
