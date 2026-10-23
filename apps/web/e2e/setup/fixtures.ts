/**
 * Фикстуры сценариев E2E. Данные помечены префиксом E2E и живут только в базе `<db>_e2e`.
 * Времена привязаны к моменту запуска, чтобы «текущий индекс», прогноз и предупреждение были актуальны.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseCapAlert } from "@meteo/core";
import { computeStationIndexes, createDb, eq, ingestCapAlert, sql } from "@meteo/db";
import * as s from "@meteo/db/schema";

export const E2E = {
  station: { code: "E2E-DU-01", slug: "e2e-dushanbe-center" },
  station2: { code: "E2E-KT-01", slug: "e2e-bokhtar-south" },
  /** Станции сети датчиков, которые наполняет один JSON‑источник (file://, без интернета). */
  jsonStations: {
    a: { code: "E2E-JSON-A", slug: "e2e-json-a", sourceId: "A_ECO" },
    b: { code: "E2E-JSON-B", slug: "e2e-json-b", sourceId: "B_ECO" },
  },
  jsonSourceLabel: "E2E JSON API",
  /** Район Душанбе с геометрией — для /api/v1/districts и контуров районов на карте. */
  district: { code: "E2E-DU-D1" },
  /** Названия областей из seed — для попапа слоя границ. */
  regionName: { KT: { ru: "Хатлонская область" } },
  capIdentifier: "e2e.cap.2026.0001",
  capHeadline: {
    ru: "Сильный ветер в Душанбе (E2E)",
    en: "Strong wind in Dushanbe (E2E)",
    tg: "Шамоли сахт дар Душанбе (E2E)",
  },
  news: {
    slug: "e2e-published-news",
    title: { tg: "Хабари озмоишии E2E", ru: "Тестовая новость E2E", en: "E2E test news" },
  },
  suspectPollutant: "PM25",
  /** Станция Душанбе измеряет NO₂ и SO₂ — для суммации по методике Агентства на странице станции. */
  summationPollutants: ["NO2", "SO2"],
} as const;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 1×1 прозрачный PNG — заглушка растрового слоя SILAM. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const floorHour = (d: Date) => new Date(Math.floor(d.getTime() / HOUR) * HOUR);
/** Час суток по Душанбе (UTC+5, без перехода на летнее время). */
const dushanbeHour = (d: Date) => (((d.getTime() / HOUR + 5) % 24) + 24) % 24;
const localMidnightUtc = (d: Date) => {
  const shifted = new Date(d.getTime() + 5 * HOUR);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 5 * HOUR,
  );
};
const runStamp = (d: Date) => d.toISOString().slice(0, 13).replace(/[-T]/g, "");

export interface FixtureOptions {
  databaseUrl: string;
  silamDir: string;
  /** Каталог данных E2E: сюда пишутся файлы‑ответы JSON‑источника. */
  dataDir: string;
  adminEmail: string;
  appUrl: string;
}

export async function seedE2eFixtures(opts: FixtureOptions): Promise<void> {
  const db = createDb(opts.databaseUrl, { max: 2 });
  try {
    const now = new Date();
    const pollutantRows = await db
      .select({ id: s.pollutants.id, code: s.pollutants.code })
      .from(s.pollutants);
    const pid = new Map(pollutantRows.map((p) => [p.code, p.id]));
    const regionRows = await db.select({ id: s.regions.id, code: s.regions.code }).from(s.regions);
    const rid = new Map(regionRows.map((r) => [r.code, r.id]));
    const need = (map: Map<string, number>, key: string) => {
      const v = map.get(key);
      if (v === undefined) throw new Error(`[e2e] нет справочного значения ${key}`);
      return v;
    };

    // --- границы: прямоугольники областей (Душанбе — «дыра» внутри РРП) и один район Душанбе -------
    // Реальные полигоны грузит infra/data/load-boundaries.ts; в E2E нужны лишь предсказуемые
    // контуры для /api/v1/regions, /api/v1/districts и попапа слоя границ.
    const ring = (w: number, s: number, e: number, n: number) =>
      `(${w} ${s}, ${e} ${s}, ${e} ${n}, ${w} ${n}, ${w} ${s})`;
    const dushanbeRing = ring(68.65, 38.45, 68.95, 38.65);
    const regionWkt: Record<string, string> = {
      SU: `MULTIPOLYGON((${ring(68.0, 39.4, 70.5, 41.0)}))`,
      RRP: `MULTIPOLYGON((${ring(68.0, 38.3, 70.5, 39.4)}, ${dushanbeRing}))`,
      DU: `MULTIPOLYGON((${dushanbeRing}))`,
      KT: `MULTIPOLYGON((${ring(68.0, 36.9, 70.5, 38.3)}))`,
      GB: `MULTIPOLYGON((${ring(70.5, 36.9, 75.0, 41.0)}))`,
    };
    for (const [code, wkt] of Object.entries(regionWkt)) {
      await db.execute(sql`
        update regions
           set geom = ST_GeomFromText(${wkt}, 4326),
               centroid = ST_PointOnSurface(ST_GeomFromText(${wkt}, 4326))
         where code = ${code}`);
    }
    const [district] = await db
      .insert(s.districts)
      .values({
        regionId: need(rid, "DU"),
        code: E2E.district.code,
        name: { tg: "Ноҳияи Сино (E2E)", ru: "Район Сино (E2E)", en: "Sino district (E2E)" },
        geom: {
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [68.7, 38.5],
                [68.85, 38.5],
                [68.85, 38.6],
                [68.7, 38.6],
                [68.7, 38.5],
              ],
            ],
          ],
        },
      })
      .returning({ id: s.districts.id });
    if (!district) throw new Error("[e2e] район не создан");

    // --- станции ------------------------------------------------------------------------------
    const [station] = await db
      .insert(s.stations)
      .values({
        code: E2E.station.code,
        slug: E2E.station.slug,
        name: {
          tg: "Душанбе — марказ (E2E)",
          ru: "Душанбе — центр (E2E)",
          en: "Dushanbe centre (E2E)",
        },
        kind: "air",
        geom: { x: 68.78, y: 38.56 },
        regionId: need(rid, "DU"),
        districtId: district.id,
        status: "active",
        dataSource: "sensor",
        sampling: "continuous",
        isPublic: true,
        address: { ru: "ул. Рудаки, 1", en: "Rudaki ave., 1", tg: "х. Рӯдакӣ, 1" },
      })
      .returning({ id: s.stations.id });
    const [station2] = await db
      .insert(s.stations)
      .values({
        code: E2E.station2.code,
        slug: E2E.station2.slug,
        name: { tg: "Бохтар — ҷануб (E2E)", ru: "Бохтар — юг (E2E)", en: "Bokhtar south (E2E)" },
        kind: "air",
        geom: { x: 68.78, y: 37.83 },
        regionId: need(rid, "KT"),
        status: "active",
        dataSource: "manual",
        sampling: "discrete",
        isPublic: true,
      })
      .returning({ id: s.stations.id });
    if (!station || !station2) throw new Error("[e2e] станции не созданы");
    await db.insert(s.stationPollutants).values([
      { stationId: station.id, pollutantId: need(pid, "PM25"), inputUnit: "µg/m³" },
      { stationId: station.id, pollutantId: need(pid, "PM10"), inputUnit: "µg/m³" },
      { stationId: station.id, pollutantId: need(pid, "NO2"), inputUnit: "µg/m³" },
      { stationId: station.id, pollutantId: need(pid, "SO2"), inputUnit: "µg/m³" },
      { stationId: station2.id, pollutantId: need(pid, "PM10"), inputUnit: "µg/m³" },
    ]);

    // --- сеть датчиков: две станции и JSON‑источник в карточке первой (ответы — файлы в e2e/.data) --------
    // Формат как у wwcs.tj: массив записей {stationID, timestamp местное UTC+5 без смещения, PM25, PM10};
    // прогон — e2e/admin/station-json-source.spec.ts через скрипт worker'а pull-source (file:// разрешён
    // переменной STATION_PULL_ALLOW_FILE_URLS). Значения дают уровень 3 оперативной шкалы.
    const jsonDir = resolve(opts.dataDir, "json-source");
    mkdirSync(jsonDir, { recursive: true });
    const jsonRows = await db
      .insert(s.stations)
      .values(
        (["a", "b"] as const).map((k, i) => ({
          code: E2E.jsonStations[k].code,
          slug: E2E.jsonStations[k].slug,
          name: {
            tg: `Датчики ${k.toUpperCase()} (E2E)`,
            ru: `Датчик ${k.toUpperCase()} (E2E)`,
            en: `Sensor ${k.toUpperCase()} (E2E)`,
          },
          kind: "air" as const,
          // Согд, вне полигонов Душанбе и тестового района: счётчики станций в map.spec остаются прежними.
          geom: { x: 69.63 + i * 0.3, y: 40.28 - i * 0.4 },
          regionId: need(rid, "SU"),
          status: "active" as const,
          dataSource: "sensor" as const,
          sampling: "continuous" as const,
          isPublic: true,
        })),
      )
      .returning({ id: s.stations.id, code: s.stations.code });
    await db.insert(s.stationPollutants).values(
      jsonRows.flatMap((r) => [
        { stationId: r.id, pollutantId: need(pid, "PM25"), inputUnit: "µg/m³" },
        { stationId: r.id, pollutantId: need(pid, "PM10"), inputUnit: "µg/m³" },
      ]),
    );
    const localStamp = (d: Date) => new Date(d.getTime() + 5 * HOUR).toISOString().slice(0, 19);
    const step = 10 * 60_000;
    const latest = new Date(Math.floor(now.getTime() / step) * step - step);
    const sensorIds = [E2E.jsonStations.a.sourceId, E2E.jsonStations.b.sourceId];
    const history = sensorIds.flatMap((stationID, si) =>
      Array.from({ length: 6 }, (_, i) => ({
        stationID,
        timestamp: localStamp(new Date(latest.getTime() - (6 - i) * step)),
        PM25: 38 + si * 3 + i * 0.5,
        PM10: 68 + si * 4 + i,
      })),
    );
    const current = sensorIds.map((stationID, si) => ({
      stationID,
      siteName: `Sensor ${stationID}`,
      latitude: 40.28 - si * 0.4,
      longitude: 69.63 + si * 0.3,
      altitude: 800,
      timestamp: localStamp(latest),
      PM25: 41 + si * 3,
      PM10: 74 + si * 4,
      temperature: 21.5,
      humidity: 30,
      aqi: 100,
    }));
    const stationsFile = resolve(jsonDir, "stations.json");
    const historyFile = resolve(jsonDir, "history.json");
    writeFileSync(stationsFile, JSON.stringify(current, null, 1));
    writeFileSync(historyFile, JSON.stringify(history, null, 1));
    const anchor = jsonRows.find((r) => r.code === E2E.jsonStations.a.code);
    if (!anchor) throw new Error("[e2e] станция JSON‑источника не создана");
    await db.insert(s.stationSources).values({
      stationId: anchor.id,
      kind: "json",
      enabled: true,
      label: E2E.jsonSourceLabel,
      host: "",
      path: pathToFileURL(stationsFile).toString(),
      filePattern: "*",
      mapping: {
        format: "json",
        stationField: "stationID",
        stations: {
          [E2E.jsonStations.a.sourceId]: E2E.jsonStations.a.code,
          [E2E.jsonStations.b.sourceId]: E2E.jsonStations.b.code,
        },
        time: { field: "timestamp", timezone: "Asia/Dushanbe", roundMin: 10 },
        pollutants: {
          PM25: { field: "PM25", unit: "µg/m³" },
          PM10: { field: "PM10", unit: "µg/m³" },
        },
        averagingMin: 10,
        history: { url: `${pathToFileURL(historyFile).toString()}?hours={hours}`, hours: 24 },
      },
      staleAfterMin: 60,
      createdBy: "e2e",
    });

    // --- измерения: 48 часов, валидные, плюс одно «подозрительное» для очереди QC ------------------
    const from = floorHour(new Date(now.getTime() - 48 * HOUR));
    const rows: Array<typeof s.measurements.$inferInsert> = [];
    for (let t = from.getTime(); t <= floorHour(now).getTime(); t += HOUR) {
      const h = (t - from.getTime()) / HOUR;
      const wave = Math.sin((h / 24) * 2 * Math.PI);
      const base = {
        time: new Date(t),
        stationId: station.id,
        averagingMin: 60,
        qcFlag: 1,
        source: 4,
      };
      rows.push({
        ...base,
        pollutantId: need(pid, "PM25"),
        value: Math.round((38 + 14 * wave) * 10) / 10,
      });
      rows.push({
        ...base,
        pollutantId: need(pid, "PM10"),
        value: Math.round((62 + 20 * wave) * 10) / 10,
      });
      rows.push({
        ...base,
        pollutantId: need(pid, "NO2"),
        value: Math.round((24 + 8 * wave) * 10) / 10,
      });
      rows.push({
        ...base,
        pollutantId: need(pid, "SO2"),
        value: Math.round((6 + 2 * wave) * 10) / 10,
      });
    }
    // Подозрительное значение ≈ 3 часа назад, но не в часы, которые перезаписывают другие сценарии:
    // 07:00 по Душанбе — ручной ввод (e2e/admin/measurements.spec.ts), 4–6 ч назад — приём по API
    // (e2e/public/ingest.spec.ts пишет PM2.5 «<5» за текущий час − 4 ч). Поэтому из 07:00 сдвигаем
    // вперёд, на 2 ч назад: сдвиг назад попадал под приём по API, и в 10:00–11:00 очередь QC пустела.
    let suspectTime = floorHour(new Date(now.getTime() - 3 * HOUR));
    if (dushanbeHour(suspectTime) === 7) suspectTime = new Date(suspectTime.getTime() + HOUR);
    for (const r of rows) {
      if (
        r.pollutantId === need(pid, E2E.suspectPollutant) &&
        (r.time as Date).getTime() === suspectTime.getTime()
      ) {
        r.value = 480;
        r.qcFlag = 2;
        r.qcReason = "spike";
      }
    }
    await db.insert(s.measurements).values(rows).onConflictDoNothing();
    await computeStationIndexes(db, { stationIds: [station.id], hours: 50 });

    // --- прогноз SmartMet для Душанбе и Худжанда ---------------------------------------------
    const locations = await db
      .select({ id: s.forecastLocations.id, slug: s.forecastLocations.slug })
      .from(s.forecastLocations);
    const locationId = (slug: string) => {
      const row = locations.find((l) => l.slug === slug);
      if (!row) throw new Error(`[e2e] нет точки прогноза ${slug}`);
      return row.id;
    };
    const [run] = await db
      .insert(s.forecastRuns)
      .values({
        provider: "smartmet",
        producer: "e2e-fixture",
        originTime: new Date(now.getTime() - 2 * HOUR),
        fetchedAt: now,
      })
      .returning({ id: s.forecastRuns.id });
    const points: Array<typeof s.forecastPoints.$inferInsert> = [];
    for (const slug of ["dushanbe", "khujand"]) {
      const offset = slug === "dushanbe" ? 0 : -4;
      const start = floorHour(now);
      for (let i = 0; i < 72; i += 1) {
        const time = new Date(start.getTime() + i * HOUR);
        const localHour = (((time.getTime() / HOUR + 5) % 24) + 24) % 24;
        const t = 18 + offset + 7 * Math.sin(((localHour - 9) / 24) * 2 * Math.PI);
        points.push({
          locationId: locationId(slug),
          time,
          stepMin: 60,
          runId: run?.id,
          params: {
            t: Math.round(t * 10) / 10,
            ws: 3.2,
            wd: 180,
            gust: 6,
            rh: 45,
            p: 1012,
            dew: 4,
            precip: i % 11 === 0 ? 0.4 : 0,
            cloud: 20,
            symbol: localHour >= 20 || localHour < 6 ? 101 : 1,
          },
        });
      }
      const day0 = localMidnightUtc(now);
      for (let d = 0; d < 10; d += 1) {
        points.push({
          locationId: locationId(slug),
          time: new Date(day0.getTime() + d * DAY),
          stepMin: 1440,
          runId: run?.id,
          params: {
            tmax: 25 + offset - d * 0.5,
            tmin: 11 + offset,
            precipSum: d === 2 ? 3.2 : 0,
            symbol: d === 2 ? 31 : 1,
          },
        });
      }
    }
    await db.insert(s.forecastPoints).values(points).onConflictDoNothing();

    // --- SILAM: прогон, растровые слои (PNG-заглушки) и точечный прогноз -------------------------
    const originTime = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const [silamRun] = await db
      .insert(s.silamRuns)
      .values({
        originTime,
        fetchedAt: now,
        status: "ok",
        hours: 48,
        grid: { nx: 64, ny: 48, west: 67, south: 36.5, east: 75.5, north: 41.5 },
        meta: { source: "e2e-fixture" },
      })
      .returning({ id: s.silamRuns.id });
    if (!silamRun) throw new Error("[e2e] прогон SILAM не создан");
    const stamp = runStamp(originTime);
    const fields: Array<typeof s.silamFields.$inferInsert> = [];
    for (const code of ["PM25", "PM10"]) {
      for (let i = 0; i < 6; i += 1) {
        const time = new Date(floorHour(now).getTime() + (i - 1) * HOUR);
        const hourIdx = Math.max(0, Math.round((time.getTime() - originTime.getTime()) / HOUR));
        const file = `${stamp}/${code}/${String(hourIdx).padStart(3, "0")}.png`;
        const abs = resolve(opts.silamDir, file);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, PNG_1X1);
        fields.push({
          runId: silamRun.id,
          pollutantId: need(pid, code),
          time,
          file,
          stats: { min: 2, max: 48 + i, mean: 20 },
        });
      }
    }
    await db.insert(s.silamFields).values(fields).onConflictDoNothing();
    const pointRows: Array<typeof s.silamPointForecast.$inferInsert> = [];
    const tomorrow = localMidnightUtc(new Date(now.getTime() + DAY));
    for (let i = 0; i < 48; i += 1) {
      const time = new Date(tomorrow.getTime() - 5 * HOUR + i * HOUR);
      for (const code of ["PM25", "PM10"]) {
        const value = code === "PM25" ? 28 + 6 * Math.sin(i / 4) : 55 + 10 * Math.sin(i / 4);
        pointRows.push({
          runId: silamRun.id,
          locationId: locationId("dushanbe"),
          stationId: null,
          pollutantId: need(pid, code),
          time,
          value: Math.round(value * 10) / 10,
          level: 0,
        });
        pointRows.push({
          runId: silamRun.id,
          locationId: null,
          stationId: station.id,
          pollutantId: need(pid, code),
          time,
          value: Math.round(value * 10) / 10,
          level: 0,
        });
      }
    }
    await db.insert(s.silamPointForecast).values(pointRows).onConflictDoNothing();

    // --- CAP-предупреждение (Actual/Alert, действует 2 дня) ------------------------------------
    const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "+00:00");
    const sent = new Date(now.getTime() - HOUR);
    const expires = new Date(now.getTime() + 2 * DAY);
    const info = (
      language: string,
      event: string,
      headline: string,
      description: string,
      instruction: string,
      areaDesc: string,
    ) => `
  <info>
    <language>${language}</language>
    <category>Met</category>
    <event>${event}</event>
    <urgency>Expected</urgency>
    <severity>Severe</severity>
    <certainty>Likely</certainty>
    <effective>${iso(sent)}</effective>
    <onset>${iso(sent)}</onset>
    <expires>${iso(expires)}</expires>
    <senderName>Агентии обуҳавошиносӣ (E2E)</senderName>
    <headline>${headline}</headline>
    <description>${description}</description>
    <instruction>${instruction}</instruction>
    <area>
      <areaDesc>${areaDesc}</areaDesc>
      <polygon>38.70,68.60 38.70,69.00 38.40,69.00 38.40,68.60 38.70,68.60</polygon>
      <geocode><valueName>region</valueName><value>DU</value></geocode>
    </area>
  </info>`;
    const capXml = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>${E2E.capIdentifier}</identifier>
  <sender>alert@meteo.tj</sender>
  <sent>${iso(sent)}</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>${info("ru-RU", "Сильный ветер", E2E.capHeadline.ru, "Порывы ветра до 25 м/с, пыль.", "Закрепите предметы, избегайте открытых пространств.", "Душанбе")}${info("en-US", "Strong wind", E2E.capHeadline.en, "Gusts up to 25 m/s, dust.", "Secure loose objects, avoid open areas.", "Dushanbe")}${info("tg-TJ", "Шамоли сахт", E2E.capHeadline.tg, "Шиддати шамол то 25 м/с, чанг.", "Ашёҳоро мустаҳкам кунед.", "Душанбе")}
</alert>`;
    await ingestCapAlert(db, parseCapAlert(capXml), {
      rawXml: capXml,
      sourceUrl: "e2e://fixtures/wind.xml",
    });

    // --- опубликованная новость --------------------------------------------------------------
    const [adminUser] = await db
      .select({ id: s.users.id })
      .from(s.users)
      .where(eq(s.users.email, opts.adminEmail.toLowerCase()));
    const [category] = await db
      .select({ id: s.newsCategories.id })
      .from(s.newsCategories)
      .where(eq(s.newsCategories.slug, "news"));
    await db.insert(s.newsPosts).values({
      slug: E2E.news.slug,
      categoryId: category?.id ?? null,
      title: E2E.news.title,
      excerpt: { tg: "Анонси E2E", ru: "Анонс тестовой новости E2E", en: "E2E test news excerpt" },
      body: {
        tg: "## Матни озмоишӣ\n\nИн хабар барои санҷиши E2E сохта шудааст.",
        ru: "## Тестовый текст\n\nЭта новость создана для сквозных тестов портала.",
        en: "## Test body\n\nThis post exists for end-to-end tests of the portal.",
      },
      status: "published",
      publishedAt: new Date(now.getTime() - HOUR),
      pinned: false,
      authorId: adminUser?.id ?? null,
      updatedBy: adminUser?.id ?? null,
    });

    const counts = await db.execute<{ measurements: number; index: number }>(sql`
      select (select count(*) from measurements)::int as measurements,
             (select count(*) from station_index)::int as index
    `);
    console.info(
      `[e2e] фикстуры: станции 2 + 2 (JSON‑источник), измерений ${counts[0]?.measurements}, строк индекса ${counts[0]?.index}, прогноз ${points.length} точек, SILAM ${fields.length} слоёв, CAP 1, новость 1`,
    );
  } finally {
    await db.$client.end();
  }
}
