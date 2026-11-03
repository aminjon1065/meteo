import { describe, expect, it, vi } from "vitest";

const handler = vi.fn(async () => new Response("ok"));
vi.mock("@/lib/auth", () => ({ getAuth: () => ({ handler }) }));

const route = await import("@/app/api/auth/[...all]/route");
const { isBlockedAuthPath } = await import("@/lib/auth-paths");

describe("/api/auth: эндпоинты плагина admin закрыты по HTTP", () => {
  it("set-role, ban-user, impersonate и др. — 404 без вызова better-auth", async () => {
    for (const path of [
      "/api/auth/admin/set-role",
      "/api/auth/admin/ban-user",
      "/api/auth/admin/remove-user",
      "/api/auth/admin/create-user",
      "/api/auth/admin/set-user-password",
      "/api/auth/admin/impersonate-user",
      "/api/auth/admin/list-users",
    ]) {
      const res = await route.POST(new Request(`http://localhost${path}`, { method: "POST" }));
      expect(res.status, path).toBe(404);
      const get = await route.GET(new Request(`http://localhost${path}`));
      expect(get.status, path).toBe(404);
    }
    expect(handler).not.toHaveBeenCalled();
  });

  it("вход, сессия и 2FA работают как прежде", async () => {
    for (const path of [
      "/api/auth/sign-in/email",
      "/api/auth/get-session",
      "/api/auth/two-factor/enable",
    ]) {
      const res = await route.POST(new Request(`http://localhost${path}`, { method: "POST" }));
      expect(res.status, path).toBe(200);
    }
    expect(isBlockedAuthPath("/api/auth/administrator")).toBe(false);
    expect(handler).toHaveBeenCalledTimes(3);
  });
});
