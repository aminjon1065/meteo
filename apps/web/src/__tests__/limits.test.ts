import { describe, expect, it } from "vitest";
import { rateLimitGroupFor, rateLimitKey, subscribeActionGroup } from "@/lib/security/limits";

describe("rateLimitGroupFor / rateLimitKey", () => {
  it("ingest — отдельная группа с лимитом по умолчанию 60 и ключом «станция + IP»", () => {
    const group = rateLimitGroupFor("/api/v1/ingest/DU-01");
    expect(group?.name).toBe("ingest");
    expect(group?.rule.limit).toBe(60);
    expect(
      rateLimitKey(group as NonNullable<typeof group>, "/api/v1/ingest/du-01", "1.2.3.4"),
    ).toBe("ingest:DU-01:1.2.3.4");
    expect(
      rateLimitKey(group as NonNullable<typeof group>, "/api/v1/ingest/%D0%A1%D0%A3-01", "::1"),
    ).toBe("ingest:СУ-01:::1");
  });
  it("публичный API и auth — как прежде; остальные пути без лимита", () => {
    expect(rateLimitGroupFor("/api/v1/stations")?.name).toBe("api");
    expect(rateLimitGroupFor("/api/v1/stations")?.rule.limit).toBe(120);
    expect(rateLimitGroupFor("/api/auth/get-session")?.name).toBe("auth");
    expect(rateLimitGroupFor("/api/admin/media")).toBeNull();
    expect(rateLimitGroupFor("/ru/air")).toBeNull();
    const api = rateLimitGroupFor("/api/v1/stations") as NonNullable<
      ReturnType<typeof rateLimitGroupFor>
    >;
    expect(rateLimitKey(api, "/api/v1/stations", "1.2.3.4")).toBe("api:1.2.3.4");
  });
});

describe("rateLimitKey: некорректное percent-кодирование", () => {
  it("не бросает URIError и использует сегмент как есть", () => {
    const group = rateLimitGroupFor("/api/v1/ingest/%E0%A4%A") as NonNullable<
      ReturnType<typeof rateLimitGroupFor>
    >;
    expect(rateLimitKey(group, "/api/v1/ingest/%E0%A4%A", "1.2.3.4")).toBe(
      "ingest:%E0%A4%A:1.2.3.4",
    );
    expect(rateLimitKey(group, "/api/v1/ingest/%ZZ", "1.2.3.4")).toBe("ingest:%ZZ:1.2.3.4");
  });
});

describe("subscribeActionGroup", () => {
  const req = (method: string, pathname: string, action = true) => ({
    method,
    nextUrl: { pathname },
    headers: new Headers(action ? { "next-action": "abc" } : {}),
  });
  it("лимитирует только POST server action страницы подписки", () => {
    expect(subscribeActionGroup(req("POST", "/subscribe"))?.name).toBe("subscribe");
    expect(subscribeActionGroup(req("POST", "/ru/subscribe"))?.rule.limit).toBe(10);
    expect(subscribeActionGroup(req("POST", "/en/subscribe/"))?.name).toBe("subscribe");
    expect(subscribeActionGroup(req("GET", "/ru/subscribe"))).toBeNull();
    expect(subscribeActionGroup(req("POST", "/ru/subscribe", false))).toBeNull();
    expect(subscribeActionGroup(req("POST", "/ru/subscribe/confirm"))).toBeNull();
    expect(subscribeActionGroup(req("POST", "/ru/admin/stations"))).toBeNull();
  });
});
