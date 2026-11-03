import { expect, test } from "@playwright/test";
import { E2E } from "../setup/fixtures";

/**
 * FR6.7: у каждой публичной страницы — свой canonical, hreflang (tg/ru/en + x-default, те же коды,
 * что в заголовке Link), og:title/og:url/og:image и карточка Twitter (lib/seo.ts).
 */
const PAGES = [
  "/",
  "/ru",
  "/en/air",
  `/ru/air/stations/${E2E.station.slug}`,
  "/ru/weather/dushanbe",
  "/ru/warnings",
  "/ru/news",
  `/ru/news/${E2E.news.slug}`,
  "/ru/health",
  "/ru/air/bulletins",
  "/ru/data/api",
];

function meta(html: string, attr: "property" | "name", key: string): string | undefined {
  const re = new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`);
  return html.match(re)?.[1];
}

/** Путь страницы без префикса языка: "/ru/news" → "/news", "/ru" → "/". */
function barePath(path: string): string {
  const rest = path.replace(/^\/(ru|en)(?=\/|$)/, "");
  return rest === "" ? "/" : rest;
}

for (const path of PAGES) {
  test(`SEO-метаданные ${path}`, async ({ request, baseURL }) => {
    const res = await request.get(path);
    expect(res.status()).toBe(200);
    const html = await res.text();
    const origin = new URL(baseURL ?? "http://localhost:3100").origin;
    const self = `${origin}${path === "/" ? "" : path}`;

    expect(html).toContain(`<link rel="canonical" href="${self}"`);
    const bare = barePath(path);
    const tail = bare === "/" ? "" : bare;
    for (const [lang, href] of [
      ["tg", `${origin}${tail}`],
      ["ru", `${origin}/ru${tail}`],
      ["en", `${origin}/en${tail}`],
      ["x-default", `${origin}${tail}`],
    ]) {
      expect(html, `hreflang ${lang}`).toContain(
        `<link rel="alternate" hrefLang="${lang}" href="${href}"`,
      );
    }
    expect(meta(html, "property", "og:title")).toBeTruthy();
    expect(meta(html, "property", "og:description")).toBeTruthy();
    expect(meta(html, "property", "og:url")).toBe(self);
    expect(meta(html, "property", "og:site_name")).toBeTruthy();
    expect(meta(html, "property", "og:locale")).toMatch(/^(tg_TJ|ru_RU|en_US)$/);
    expect(meta(html, "property", "og:image")).toMatch(/^https?:\/\/.+\.(jpg|png|webp)$/);
    expect(meta(html, "name", "twitter:card")).toBe("summary_large_image");
  });
}

test("картинка соцсетей и логотип для JSON-LD отдаются", async ({ request }) => {
  const og = await request.get("/og/default.jpg");
  expect(og.status()).toBe(200);
  expect(og.headers()["content-type"]).toBe("image/jpeg");
  const logo = await request.get("/og/logo.png");
  expect(logo.status()).toBe(200);
});

test("JSON-LD новости: image и publisher.logo", async ({ request }) => {
  const html = await (await request.get(`/ru/news/${E2E.news.slug}`)).text();
  const raw = html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)?.[1];
  expect(raw).toBeTruthy();
  const ld = JSON.parse(raw ?? "{}");
  expect(ld["@type"]).toBe("NewsArticle");
  expect(ld.image?.[0]).toMatch(/^https?:\/\//);
  expect(ld.publisher?.logo?.url).toMatch(/\/og\/logo\.png$/);
});

test("sitemap.xml: hreflang теми же кодами и x-default", async ({ request }) => {
  const xml = await (await request.get("/sitemap.xml")).text();
  expect(xml).toContain('hreflang="tg"');
  expect(xml).toContain('hreflang="x-default"');
  expect(xml).not.toContain("tg-Cyrl-TJ");
  expect(xml).toContain(`/ru/air/stations/${E2E.station.slug}</loc>`);
});

test("служебные страницы подписки не индексируются", async ({ request }) => {
  const html = await (await request.get("/ru/subscribe/confirm?token=x")).text();
  expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);
});
