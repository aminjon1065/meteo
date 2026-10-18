import { expect, test } from "@playwright/test";
import { E2E } from "../setup/fixtures";

test.describe("заголовки безопасности (docs/security-checklist.md)", () => {
  test("страницы: CSP с nonce и strict-dynamic, запрет framing, остальные заголовки", async ({
    request,
  }) => {
    const res = await request.get("/ru");
    const h = res.headers();
    expect(h["content-security-policy"]).toMatch(
      /script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/,
    );
    expect(h["content-security-policy"]).not.toContain("unsafe-eval");
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"]).toContain("object-src 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toContain("camera=()");
    expect(h["x-powered-by"]).toBeUndefined();
    // nonce из заголовка проставлен скриптам страницы.
    const nonce = /'nonce-([^']+)'/.exec(h["content-security-policy"] ?? "")?.[1];
    const html = await res.text();
    expect(nonce).toBeTruthy();
    expect(html).toContain(`nonce="${nonce}"`);
    expect(html).not.toMatch(/<script(?![^>]*nonce=)[^>]*src=/);
  });

  test("виджеты /embed/*: frame-ancestors для meteo.tj, без X-Frame-Options", async ({
    request,
  }) => {
    for (const path of ["/embed/aqi", "/ru/embed/forecast?location=dushanbe", "/en/embed/alerts"]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      const csp = res.headers()["content-security-policy"] ?? "";
      expect(csp, path).toContain("frame-ancestors 'self' https://meteo.tj https://*.meteo.tj");
      expect(res.headers()["x-frame-options"], path).toBeUndefined();
    }
  });

  test("загрузки: путь вне каталога и неверный формат → 404", async ({ request }) => {
    expect((await request.get("/uploads/2026/10/../../.env")).status()).toBe(404);
    expect((await request.get("/uploads/2026/10/not-a-uuid.png")).status()).toBe(404);
    expect((await request.get("/silam/../.env")).status()).toBe(404);
  });

  test("админка без сессии → редирект на вход; auth API под лимитом", async ({ request }) => {
    const res = await request.get("/ru/admin/stations", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers().location).toContain("/ru/admin/login");
    const session = await request.get("/api/auth/get-session");
    expect(session.status()).toBe(200);
    expect(session.headers()["x-ratelimit-limit"]).toBeTruthy();
  });
});

test.describe("публичный API", () => {
  test("/api/v1: лимиты, CORS, кэш и данные фикстур", async ({ request }) => {
    const stations = await request.get("/api/v1/stations");
    expect(stations.ok()).toBeTruthy();
    expect(stations.headers()["access-control-allow-origin"]).toBe("*");
    expect(stations.headers()["x-ratelimit-limit"]).toBeTruthy();
    expect(stations.headers()["x-ratelimit-remaining"]).toBeTruthy();
    expect(stations.headers()["cache-control"]).toContain("s-maxage");
    const geo = (await stations.json()) as {
      features: Array<{ properties: { slug: string; level: number } }>;
    };
    const fixture = geo.features.find((f) => f.properties.slug === E2E.station.slug);
    expect(fixture?.properties.level).toBeGreaterThan(0);
    const again = await request.get("/api/v1/stations");
    expect(again.headers()["x-cache"]).toBe("HIT");

    const current = await request.get("/api/v1/index/current");
    const body = (await current.json()) as {
      scale: { code: string };
      stations: Array<{ slug: string; level: number }>;
    };
    expect(body.scale.code).toBe("NATIONAL_OPERATIONAL");
    expect(body.stations.find((s) => s.slug === E2E.station.slug)?.level).toBeGreaterThan(0);
    expect((await request.get("/api/v1/index/current?scale=NOPE")).status()).toBe(404);

    const forecast = (await (
      await request.get("/api/v1/forecast/dushanbe?hours=24&days=3")
    ).json()) as {
      hourly: unknown[];
      daily: unknown[];
    };
    expect(forecast.hourly.length).toBe(24);
    expect(forecast.daily.length).toBe(3);
    expect((await request.get("/api/v1/forecast/no-such-city")).status()).toBe(404);

    const layers = (await (await request.get("/api/v1/silam/layers")).json()) as {
      run: { bounds: unknown } | null;
      pollutants: Array<{ code: string; frames: unknown[] }>;
    };
    expect(layers.run?.bounds).toBeTruthy();
    expect(layers.pollutants.map((p) => p.code).sort()).toEqual(["PM10", "PM25"]);

    const openapi = await request.get("/api/v1/openapi.json");
    expect(openapi.ok()).toBeTruthy();
    expect(((await openapi.json()) as { openapi: string }).openapi).toMatch(/^3\.1/);
  });

  test("CSV измерений станции", async ({ request }) => {
    const csv = await request.get(
      `/api/v1/stations/${E2E.station.slug}/measurements?range=24h&format=csv`,
    );
    expect(csv.ok()).toBeTruthy();
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const text = await csv.text();
    expect(text.split("\n").length).toBeGreaterThan(10);
  });
});
