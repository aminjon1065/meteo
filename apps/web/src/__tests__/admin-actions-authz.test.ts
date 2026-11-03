/**
 * FR7.1, негативные тесты ролей на сервере: каждый server action админки вызывается напрямую (как это
 * может сделать любой с cookie сессии, минуя интерфейс) от имени admin, operator, editor и
 * неизвестной роли. Проверяем, что запрещённые по матрице прав действия обрываются редиректом на
 * /admin/forbidden до любого обращения к базе, а разрешённые проходят проверку прав.
 */
import { readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

class RedirectSignal extends Error {
  constructor(readonly href: string) {
    super(`redirect:${href}`);
  }
}
class DbTouched extends Error {}

const state: { session: unknown } = { session: null };

vi.mock("@/i18n/navigation", () => ({
  redirect: ({ href }: { href: string }) => {
    throw new RedirectSignal(href);
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: () => {},
  revalidateTag: () => {},
  updateTag: () => {},
}));
vi.mock("@/lib/auth", () => ({
  getAuth: () => ({
    api: new Proxy(
      { getSession: async () => state.session },
      {
        get: (target, prop) =>
          prop in target
            ? target[prop as keyof typeof target]
            : () => {
                throw new DbTouched(String(prop));
              },
      },
    ),
  }),
}));
// Любое обращение к базе после проверки прав — признак, что действие проверку прошло.
vi.mock("@/lib/db", () => ({
  getDb: () =>
    new Proxy(
      {},
      {
        get: (_t, prop) => {
          throw new DbTouched(String(prop));
        },
      },
    ),
}));
vi.mock("@/lib/jobs", () => ({
  enqueueJob: async () => {
    throw new DbTouched("enqueueJob");
  },
}));

const ADMIN_DIR = resolve(import.meta.dirname, "../app/[locale]/admin/(app)");

function findActionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return findActionFiles(full);
    return name === "actions.ts" ? [full] : [];
  });
}

/** Модуль (каталог раздела админки относительно (app)) → какие роли кроме admin могут его действия. */
const ALLOWED_FOR: Record<string, Array<"operator" | "editor">> = {
  measurements: ["operator"],
  "measurements/qc": ["operator"],
  "eco-bulletins": ["operator", "editor"],
  news: ["editor"],
  media: ["editor"],
  bulletins: ["editor"],
};

type Action = (...args: unknown[]) => Promise<unknown>;
/** Аргументы, с которыми действие доходит до проверки прав (иначе — общий ("ru", {}, {})). */
const ARGS: Record<string, unknown[]> = {
  // Статус сначала сверяется со списком (до сессии), поэтому передаём допустимый.
  "news.setPostStatus": ["ru", 1, "draft"],
};
const files = findActionFiles(ADMIN_DIR);
const modules: Array<{ section: string; name: string; fn: Action }> = [];
for (const file of files) {
  const section = relative(ADMIN_DIR, file).replace(/\/actions\.ts$/, "");
  const mod = (await import(file)) as Record<string, unknown>;
  for (const [name, fn] of Object.entries(mod)) {
    if (typeof fn !== "function") continue;
    const args = ARGS[`${section}.${name}`] ?? ["ru", {}, {}];
    modules.push({ section, name, fn: () => (fn as Action)(...args) });
  }
}

function sessionOf(role: string, twoFactorEnabled = true) {
  return {
    session: { id: "s1", userId: "u1", expiresAt: new Date(Date.now() + 3_600_000) },
    user: { id: "u1", email: `${role}@test`, name: role, role, twoFactorEnabled, banned: false },
  };
}

/** forbidden / two-factor — редирект проверки прав; passed — действие пошло дальше. */
async function outcome(fn: Action): Promise<"forbidden" | "two-factor" | "login" | "passed"> {
  try {
    await fn();
    return "passed";
  } catch (error) {
    if (error instanceof RedirectSignal) {
      if (error.href.includes("/admin/forbidden")) return "forbidden";
      if (error.href.includes("/admin/two-factor")) return "two-factor";
      if (error.href.includes("/admin/login")) return "login";
    }
    return "passed";
  }
}

describe("server actions админки: проверка прав на сервере (FR7.1)", () => {
  beforeEach(() => {
    state.session = null;
  });

  it("найдены все модули действий", () => {
    expect(files.length).toBeGreaterThanOrEqual(12);
    expect(modules.length).toBeGreaterThanOrEqual(45);
  });

  it("без сессии каждое действие отправляет на вход", async () => {
    for (const m of modules) {
      expect(await outcome(m.fn), `${m.section}.${m.name}`).toBe("login");
    }
  });

  it("неизвестная роль не может вызвать ни одно действие", async () => {
    state.session = sessionOf("viewer");
    for (const m of modules) {
      expect(await outcome(m.fn), `${m.section}.${m.name}`).toBe("forbidden");
    }
  });

  it("администратор без 2FA не может вызвать ни одно действие", async () => {
    state.session = sessionOf("admin", false);
    for (const m of modules) {
      expect(await outcome(m.fn), `${m.section}.${m.name}`).toBe("two-factor");
    }
  });

  it("администратор с 2FA проходит проверку прав во всех действиях", async () => {
    state.session = sessionOf("admin");
    for (const m of modules) {
      expect(await outcome(m.fn), `${m.section}.${m.name}`).toBe("passed");
    }
  });

  for (const role of ["operator", "editor"] as const) {
    it(`${role}: разрешены только действия своих разделов, остальные — запрет`, async () => {
      state.session = sessionOf(role);
      const forbidden: string[] = [];
      const passed: string[] = [];
      for (const m of modules) {
        const expected = ALLOWED_FOR[m.section]?.includes(role) ? "passed" : "forbidden";
        const got = await outcome(m.fn);
        (got === "forbidden" ? forbidden : passed).push(`${m.section}.${m.name}`);
        expect(got, `${role} → ${m.section}.${m.name}`).toBe(expected);
      }
      // Явные запреты из ТЗ: пользователи, станции, шкалы, настройки — только администратор.
      for (const name of [
        "users.createUser",
        "users.setUserRole",
        "stations.createStation",
        "scales.saveScale",
        "settings.saveBranding",
      ]) {
        expect(forbidden).toContain(name);
      }
      expect(passed.length).toBeGreaterThan(0);
    });
  }
});

/** Route handlers /api/admin/*: право по матрице и ответ 401/403 вместо данных. */
const API_ROUTES: Array<{
  path: string;
  method: "GET" | "POST";
  params: Record<string, string>;
  allowed: Array<"admin" | "operator" | "editor">;
}> = [
  { path: "media", method: "POST", params: {}, allowed: ["admin", "editor"] },
  { path: "subscribers.csv", method: "GET", params: {}, allowed: ["admin"] },
  { path: "cap/[id]/xml", method: "GET", params: { id: "1" }, allowed: ["admin"] },
  {
    path: "eco-bulletins/[id]/[file]",
    method: "GET",
    params: { id: "1", file: "ru.docx" },
    allowed: ["admin", "operator", "editor"],
  },
];

describe("route handlers /api/admin: проверка прав (FR7.1)", () => {
  async function status(route: (typeof API_ROUTES)[number]): Promise<number | "passed"> {
    const mod = (await import(
      resolve(import.meta.dirname, `../app/api/admin/${route.path}/route.ts`)
    )) as Record<string, (req: Request, ctx: unknown) => Promise<Response>>;
    const handler = mod[route.method];
    if (!handler) throw new Error(`${route.path}: нет ${route.method}`);
    try {
      const res = await handler(
        new Request(`http://localhost/api/admin/${route.path}`, {
          method: route.method,
          body: route.method === "POST" ? new FormData() : undefined,
        }),
        { params: Promise.resolve(route.params) },
      );
      return res.status === 401 || res.status === 403 ? res.status : "passed";
    } catch {
      return "passed";
    }
  }

  it("без сессии — 401, неизвестная роль — 403", async () => {
    for (const route of API_ROUTES) {
      state.session = null;
      expect(await status(route), route.path).toBe(401);
      state.session = sessionOf("viewer");
      expect(await status(route), route.path).toBe(403);
    }
  });

  for (const role of ["admin", "operator", "editor"] as const) {
    it(`${role}: доступ только к разрешённым маршрутам`, async () => {
      state.session = sessionOf(role);
      for (const route of API_ROUTES) {
        const expected = route.allowed.includes(role) ? "passed" : 403;
        expect(await status(route), `${role} → ${route.path}`).toBe(expected);
      }
    });
  }
});
