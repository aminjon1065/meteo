import { describe, expect, it } from "vitest";
import { capSourceSite } from "../lib/warnings";

describe("capSourceSite", () => {
  it("https-лента Агентства после удачной загрузки - ссылка на её сайт", () => {
    expect(capSourceSite("https://alert.meteo.tj/capfeed.php", "ok")).toBe(
      "https://alert.meteo.tj",
    );
    expect(capSourceSite("https://alert.meteo.tj/capfeed.php", "not-modified")).toBe(
      "https://alert.meteo.tj",
    );
    expect(capSourceSite("https://alert.meteo.tj/capfeed.php", "partial")).toBe(
      "https://alert.meteo.tj",
    );
  });

  it("неудачная загрузка (например, фейковый сертификат) или выключенный источник - без ссылки", () => {
    expect(capSourceSite("https://alert.meteo.tj/capfeed.php", "failed")).toBeNull();
    expect(capSourceSite("https://alert.meteo.tj/capfeed.php", "disabled")).toBeNull();
    expect(capSourceSite("https://alert.meteo.tj/capfeed.php", undefined)).toBeNull();
  });

  it("внутренний адрес сервера портала, http и файлы - без ссылки", () => {
    expect(capSourceSite("http://smartalert/capfeed.php", "ok")).toBeNull();
    expect(capSourceSite("http://alert.havo.tj/capfeed.php", "ok")).toBeNull();
    expect(capSourceSite("file:///srv/cap/feed.atom", "ok")).toBeNull();
    expect(capSourceSite(undefined, "ok")).toBeNull();
    expect(capSourceSite("не адрес", "ok")).toBeNull();
  });
});
