import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CapParseError,
  capOverlaps,
  capWindow,
  circleToRing,
  isCapActive,
  isCapPublishable,
  isCapUpcoming,
  maxSeverity,
  normalizeCapLocale,
  parseCapAlert,
  parseCapCircle,
  parseCapDateTime,
  parseCapFeed,
  parseCapPolygon,
  parseCapReferences,
  pickCapInfo,
  severityStyle,
  xmlRootName,
} from "../cap";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/cap/${name}`, import.meta.url), "utf8");

describe("parseCapAlert", () => {
  it("разбирает трёхъязычное предупреждение с полигоном, кругом и геокодами", () => {
    const alert = parseCapAlert(fixture("wind-alert.xml"));
    expect(alert.identifier).toBe("tj.meteo.2026.0001");
    expect(alert.sender).toBe("alert@meteo.tj");
    expect(alert.sent.toISOString()).toBe("2026-10-16T01:00:00.000Z");
    expect(alert.status).toBe("Actual");
    expect(alert.msgType).toBe("Alert");
    expect(alert.scope).toBe("Public");
    expect(alert.codes).toEqual(["profile:CAP-TJ:1.0"]);
    expect(alert.references).toEqual([]);
    expect(alert.infos).toHaveLength(3);
    expect(alert.infos.map((i) => i.locale)).toEqual(["tg", "ru", "en"]);
    const ru = alert.infos[1];
    expect(ru?.event).toBe("Сильный ветер");
    expect(ru?.severity).toBe("Severe");
    expect(ru?.urgency).toBe("Expected");
    expect(ru?.certainty).toBe("Likely");
    expect(ru?.categories).toEqual(["Met"]);
    expect(ru?.responseTypes).toEqual(["Prepare"]);
    expect(ru?.eventCodes).toEqual([{ valueName: "FMI-type", value: "wind" }]);
    expect(ru?.parameters[0]).toEqual({ valueName: "awareness_level", value: "3; red; Severe" });
    expect(ru?.onset?.toISOString()).toBe("2026-10-16T07:00:00.000Z");
    expect(ru?.expires?.toISOString()).toBe("2026-10-17T16:00:00.000Z");
    expect(ru?.headline).toContain("Сильный ветер");
    expect(ru?.areas).toHaveLength(1);
    const area = ru?.areas[0];
    expect(area?.areaDesc).toBe("Душанбе и районы республиканского подчинения");
    expect(area?.geocodes).toEqual([
      { valueName: "region", value: "DU" },
      { valueName: "region", value: "RRP" },
    ]);
    // polygon: lat,lon → [lon, lat], кольцо замкнуто
    expect(area?.polygons[0]?.[0]).toEqual([68.5, 38.8]);
    expect(area?.polygons[0]).toHaveLength(5);
    expect(area?.circles[0]).toEqual({ center: [68.787, 38.5598], radiusKm: 25 });
    expect(area?.geometry?.type).toBe("MultiPolygon");
    expect(area?.geometry?.coordinates).toHaveLength(2);
    expect(area?.geometry?.coordinates[1]?.[0]).toHaveLength(49);
  });

  it("понимает префикс пространства имён, CDATA и сущности", () => {
    const alert = parseCapAlert(fixture("frost-alert.xml"));
    expect(alert.identifier).toBe("tj.meteo.2026.0002");
    const info = alert.infos[0];
    expect(info?.language).toBe("en-US");
    expect(info?.description).toContain("Ground frost of −1…−3 °C");
    expect(info?.instruction).toBe("Protect heat-loving crops & outdoor water pipes.");
    expect(info?.areas[0]?.geometry).toBeNull();
    expect(info?.areas[0]?.geocodes[0]?.value).toBe("SU");
  });

  it("разбирает Update со ссылками и Cancel без info", () => {
    const update = parseCapAlert(fixture("frost-update.xml"));
    expect(update.msgType).toBe("Update");
    expect(update.references).toEqual([
      {
        sender: "alert@meteo.tj",
        identifier: "tj.meteo.2026.0002",
        sent: new Date("2026-10-16T04:00:00.000Z"),
        raw: "alert@meteo.tj,tj.meteo.2026.0002,2026-10-16T09:00:00+05:00",
      },
    ]);
    expect(update.infos[0]?.areas).toHaveLength(2);
    const cancel = parseCapAlert(fixture("dust-cancel.xml"));
    expect(cancel.msgType).toBe("Cancel");
    expect(cancel.infos).toEqual([]);
    expect(cancel.note).toContain("отменено");
    expect(cancel.references[0]?.identifier).toBe("tj.meteo.2026.0004");
  });

  it("замыкает незамкнутый полигон и допускает несколько category", () => {
    const alert = parseCapAlert(fixture("dust-alert.xml"));
    const info = alert.infos[0];
    expect(info?.categories).toEqual(["Met", "Env"]);
    expect(info?.severity).toBe("Extreme");
    const ring = info?.areas[0]?.polygons[0];
    expect(ring).toHaveLength(5);
    expect(ring?.[0]).toEqual(ring?.[4]);
  });

  it("не публикует Test/Exercise и не Alert/Update", () => {
    const test = parseCapAlert(fixture("test-alert.xml"));
    expect(test.status).toBe("Test");
    expect(isCapPublishable(test)).toBe(false);
    expect(isCapPublishable(parseCapAlert(fixture("wind-alert.xml")))).toBe(true);
    expect(isCapPublishable(parseCapAlert(fixture("dust-cancel.xml")))).toBe(false);
  });

  it("бросает CapParseError с перечнем проблем", () => {
    const xml = `<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
      <sender>x</sender><sent>2026-10-16 10:00</sent><status>Real</status>
      <msgType>Alert</msgType><scope>Public</scope>
      <info><category>Met</category><event>Wind</event><urgency>Now</urgency>
      <severity>Severe</severity><certainty>Likely</certainty>
      <expires>2026-10-17T21:00:00</expires>
      <area><areaDesc>A</areaDesc><polygon>1,2 3,4</polygon></area></info></alert>`;
    let error: unknown;
    try {
      parseCapAlert(xml);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(CapParseError);
    const issues = (error as CapParseError).issues;
    expect(issues).toContain("нет identifier");
    expect(issues.some((i) => i.includes("sent"))).toBe(true);
    expect(issues.some((i) => i.includes("status"))).toBe(true);
    expect(issues.some((i) => i.includes("urgency"))).toBe(true);
    expect(issues.some((i) => i.includes("expires"))).toBe(true);
    expect(issues.some((i) => i.includes("polygon"))).toBe(true);
  });

  it("требует info у Alert/Update и корневой <alert>", () => {
    expect(() =>
      parseCapAlert(
        `<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2"><identifier>a</identifier><sender>s</sender><sent>2026-10-16T06:00:00+05:00</sent><status>Actual</status><msgType>Alert</msgType><scope>Public</scope></alert>`,
      ),
    ).toThrow(/info/);
    expect(() => parseCapAlert("<feed/>")).toThrow(CapParseError);
    expect(() => parseCapAlert("not xml <<")).toThrow(CapParseError);
  });
});

describe("примитивы CAP", () => {
  it("parseCapDateTime принимает только ISO со смещением", () => {
    expect(parseCapDateTime("2026-10-16T12:00:00+05:00")?.toISOString()).toBe(
      "2026-10-16T07:00:00.000Z",
    );
    expect(parseCapDateTime("2026-10-16T07:00:00Z")?.toISOString()).toBe(
      "2026-10-16T07:00:00.000Z",
    );
    expect(parseCapDateTime("2026-10-16 12:00")).toBeNull();
    expect(parseCapDateTime("")).toBeNull();
  });
  it("parseCapReferences разбирает несколько ссылок", () => {
    const refs = parseCapReferences(
      "a@x,id-1,2026-10-16T06:00:00+05:00 b@y,id-2,2026-10-16T07:00:00+05:00 lonely",
    );
    expect(refs.map((r) => r.identifier)).toEqual(["id-1", "id-2", "lonely"]);
    expect(refs[1]?.sender).toBe("b@y");
    expect(refs[2]?.sent).toBeNull();
    expect(parseCapReferences(null)).toEqual([]);
  });
  it("parseCapPolygon проверяет диапазоны и число точек", () => {
    expect(parseCapPolygon("38.8,68.5 38.8,69.1 38.3,69.1")).toHaveLength(4);
    expect(parseCapPolygon("38.8,68.5 38.8,69.1")).toBeNull();
    expect(parseCapPolygon("98.8,68.5 38.8,69.1 38.3,69.1")).toBeNull();
    expect(parseCapPolygon("a,b c,d e,f")).toBeNull();
  });
  it("parseCapCircle и circleToRing", () => {
    expect(parseCapCircle("38.5598,68.787 25")).toEqual({
      center: [68.787, 38.5598],
      radiusKm: 25,
    });
    expect(parseCapCircle("38.5598,68.787")).toBeNull();
    expect(parseCapCircle("38.5598,68.787 0")).toBeNull();
    const ring = circleToRing({ center: [68.787, 38.5598], radiusKm: 25 }, 8);
    expect(ring).toHaveLength(9);
    expect(ring[0]).toEqual(ring[8]);
    // северная точка: +25 км по широте ≈ +0.2246°
    expect(ring[0]?.[1]).toBeCloseTo(38.5598 + 25 / 111.32, 3);
  });
  it("normalizeCapLocale", () => {
    expect(normalizeCapLocale("tg-TJ")).toBe("tg");
    expect(normalizeCapLocale("tgk")).toBe("tg");
    expect(normalizeCapLocale("ru_RU")).toBe("ru");
    expect(normalizeCapLocale("EN-GB")).toBe("en");
    expect(normalizeCapLocale("fi-FI")).toBeNull();
    expect(normalizeCapLocale(undefined)).toBeNull();
  });
  it("цвета по severity как в MeteoAlarm", () => {
    expect(severityStyle("Minor").key).toBe("yellow");
    expect(severityStyle("Moderate").key).toBe("orange");
    expect(severityStyle("Severe").key).toBe("red");
    expect(severityStyle("Extreme").key).toBe("red");
    expect(severityStyle("Unknown").key).toBe("none");
    expect(severityStyle("garbage").level).toBe(0);
    expect(maxSeverity(["Minor", "Extreme", "Moderate"])).toBe("Extreme");
    expect(maxSeverity([])).toBe("Unknown");
  });
  it("окно действия: onset → effective → sent, expires", () => {
    const sent = new Date("2026-10-16T01:00:00Z");
    const w = capWindow(
      {
        onset: null,
        effective: new Date("2026-10-16T02:00:00Z"),
        expires: new Date("2026-10-17T00:00:00Z"),
      },
      sent,
    );
    expect(w.start.toISOString()).toBe("2026-10-16T02:00:00.000Z");
    expect(isCapUpcoming(w, new Date("2026-10-16T01:30:00Z"))).toBe(true);
    expect(isCapActive(w, new Date("2026-10-16T03:00:00Z"))).toBe(true);
    expect(isCapActive(w, new Date("2026-10-17T00:00:00Z"))).toBe(false);
    expect(capOverlaps(w, new Date("2026-10-16T19:00:00Z"), new Date("2026-10-17T19:00:00Z"))).toBe(
      true,
    );
    expect(capOverlaps(w, new Date("2026-10-17T19:00:00Z"), new Date("2026-10-18T19:00:00Z"))).toBe(
      false,
    );
    const open = capWindow({ onset: null, effective: null, expires: null }, sent);
    expect(open.start).toBe(sent);
    expect(isCapActive(open, new Date("2030-01-01T00:00:00Z"))).toBe(true);
  });
  it("pickCapInfo с фолбэком tg → ru → en → первый", () => {
    const infos = [{ locale: "en" }, { locale: "ru" }, { locale: null }];
    expect(pickCapInfo(infos, "ru")?.locale).toBe("ru");
    expect(pickCapInfo(infos, "tg")?.locale).toBe("ru");
    expect(pickCapInfo([{ locale: null }, { locale: "en" }], "tg")?.locale).toBe("en");
    expect(pickCapInfo([{ locale: "fi" }], "tg")?.locale).toBe("fi");
    expect(pickCapInfo([], "tg")).toBeNull();
  });
});

describe("parseCapFeed", () => {
  it("Atom: предпочитает ссылку application/cap+xml и разрешает относительные пути", () => {
    const feed = parseCapFeed(fixture("feed.atom"), "https://alert.meteo.tj/cap/feed.atom");
    expect(feed.kind).toBe("atom");
    expect(feed.links).toEqual([
      "https://alert.meteo.tj/cap/wind-alert.xml",
      "https://alert.meteo.tj/cap/frost-alert.xml",
      "https://alert.meteo.tj/cap/frost-update.xml",
      "https://alert.meteo.tj/cap/dust-alert.xml",
      "https://alert.meteo.tj/cap/dust-cancel.xml",
      "https://alert.meteo.tj/cap/test-alert.xml",
    ]);
    expect(feed.inline).toEqual([]);
  });
  it("Atom: file:// и встроенный CAP в content", () => {
    const feed = parseCapFeed(fixture("feed.atom"), "file:///srv/cap/feed.atom");
    expect(feed.links[0]).toBe("file:///srv/cap/wind-alert.xml");
    const inline = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>1</id>
      <content type="application/cap+xml">${fixture("dust-cancel.xml").replace(/<\?xml[^>]*\?>/, "")}</content></entry></feed>`;
    const parsed = parseCapFeed(inline, "https://x/feed");
    expect(parsed.kind).toBe("atom");
    expect(parsed.links).toEqual([]);
    expect(parsed.inline).toHaveLength(1);
    expect(parseCapAlert(parsed.inline[0] as string).identifier).toBe("tj.meteo.2026.0005");
  });

  it("Atom SmartAlert: пропускает запись «нет предупреждений» со ссылкой на саму ленту", () => {
    const empty = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">
      <entry><id>http://smartalert/capfeed.php</id><title>There are no active watches, warnings or advisories</title>
      <link href="http://smartalert/capfeed.php"/></entry></feed>`;
    expect(parseCapFeed(empty, "http://smartalert/capfeed.php").links).toEqual([]);
    const withAlert = empty.replace(
      "</feed>",
      `<entry><id>a</id><link rel="related" type="application/cap+xml" href="http://smartalert/data/publishedCap/2026-10-29/TJ_ALERT_1.xml"/></entry></feed>`,
    );
    expect(parseCapFeed(withAlert, "http://smartalert/capfeed.php").links).toEqual([
      "http://smartalert/data/publishedCap/2026-10-29/TJ_ALERT_1.xml",
    ]);
  });
  it("одиночный CAP, RSS и HTML‑листинг", () => {
    const single = parseCapFeed(fixture("wind-alert.xml"));
    expect(single.kind).toBe("alert");
    expect(single.inline).toHaveLength(1);
    const rss = parseCapFeed(
      `<rss version="2.0"><channel><item><link>https://x/a.xml</link></item><item><enclosure url="/b.xml" type="application/cap+xml"/><link>https://x/page</link></item></channel></rss>`,
      "https://x/rss",
    );
    expect(rss.kind).toBe("rss");
    expect(rss.links).toEqual(["https://x/a.xml", "https://x/b.xml"]);
    const html = parseCapFeed(
      `<html><body><a href="../">..</a><a href="a.xml">a.xml</a><a href='b.xml'>b</a><a href="a.xml">dup</a></body></html>`,
      "https://x/cap/",
    );
    expect(html.kind).toBe("html");
    expect(html.links).toEqual(["https://x/cap/a.xml", "https://x/cap/b.xml"]);
    expect(parseCapFeed("plain text").kind).toBe("unknown");
    expect(xmlRootName('<?xml version="1.0"?>\n<cap:alert xmlns:cap="x">')).toBe("alert");
  });
});
