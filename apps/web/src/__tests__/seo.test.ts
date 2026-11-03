import { afterEach, describe, expect, it } from "vitest";
import { absoluteUrl, languageAlternates, localizedPath, ogLocale, siteUrl } from "@/lib/seo";
import { FORECAST_STALE_MS, isForecastStale } from "@/lib/weather";

describe("seo", () => {
  const saved = process.env.NEXT_PUBLIC_APP_URL;
  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = saved;
  });

  it("путь на языке: tg без префикса, главная без лишнего «/»", () => {
    expect(localizedPath("tg", "/")).toBe("/");
    expect(localizedPath("ru", "/")).toBe("/ru");
    expect(localizedPath("en", "/air/stations/x")).toBe("/en/air/stations/x");
    expect(localizedPath("tg", "/weather")).toBe("/weather");
  });

  it("адрес сайта из окружения, без «/» в конце", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://havo.tj/";
    expect(siteUrl()).toBe("https://havo.tj");
    expect(absoluteUrl("ru", "/warnings")).toBe("https://havo.tj/ru/warnings");
  });

  it("hreflang — короткие коды как в заголовке Link next-intl, плюс x-default на tg", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://havo.tj";
    expect(languageAlternates("/news")).toEqual({
      tg: "https://havo.tj/news",
      ru: "https://havo.tj/ru/news",
      en: "https://havo.tj/en/news",
      "x-default": "https://havo.tj/news",
    });
  });

  it("og:locale в формате язык_СТРАНА", () => {
    expect(ogLocale).toEqual({ tg: "tg_TJ", ru: "ru_RU", en: "en_US" });
  });
});

describe("устаревание прогноза SmartMet", () => {
  const now = Date.UTC(2026, 10, 2, 12);
  it("нет синхронизации — устарел", () => {
    expect(isForecastStale(null, now)).toBe(true);
  });
  it("порог 3 ч", () => {
    expect(isForecastStale(new Date(now - FORECAST_STALE_MS + 60_000), now)).toBe(false);
    expect(isForecastStale(new Date(now - FORECAST_STALE_MS - 60_000), now)).toBe(true);
  });
});
