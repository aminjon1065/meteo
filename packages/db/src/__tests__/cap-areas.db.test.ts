/**
 * Регион области CAP без геокода (как пишет редактор SmartMet Alert): по названию района, иначе по
 * геометрии со строгим порогом; страница города не получает предупреждение соседнего района.
 * Нужна база с миграциями (границы не нужны: тест создаёт свои регионы вдали от Таджикистана):
 * TEST_DATABASE_URL=postgres://meteo:meteo@localhost:5432/meteo pnpm --filter @meteo/db test
 * Без TEST_DATABASE_URL тесты пропускаются; свои строки тест удаляет за собой.
 */
import { parseCapAlert } from "@meteo/core";
import { eq, inArray, like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../client";
import * as s from "../schema";
import { ingestCapAlert, loadWarnings, warningIdsForPoint } from "../services/cap";

const url = process.env.TEST_DATABASE_URL;
const H = 3_600_000;
// Свой префикс: файлы тестов идут параллельно, и метка только из времени могла совпасть с меткой cap.db.test
// (уборка одного файла удаляла бы строки другого).
const run = `ca${Date.now().toString(36)}`;

// Модель «Рудаки вокруг Душанбе» в океане (lon 10-16, lat -40..-37), чтобы не задеть настоящие регионы:
// CITY - город (как Душанбе), LAND - область вокруг него с «дыркой» под город (как РРП), NEXT - соседняя
// область (как Хатлон). Район «Тестобод» в LAND окружает город. Контур предупреждения, как у FMI, -
// без «дырки» под город и с полосой 0,4° в соседнюю область.
const CITY = `C-${run}`;
const LAND = `L-${run}`;
const NEXT = `N-${run}`;
const CITY_WKT = "POLYGON((11.4 -38.6,11.6 -38.6,11.6 -38.4,11.4 -38.4,11.4 -38.6))";
const LAND_WKT =
  "POLYGON((10 -40,13 -40,13 -37,10 -37,10 -40),(11.4 -38.6,11.4 -38.4,11.6 -38.4,11.6 -38.6,11.4 -38.6))";
const NEXT_WKT = "POLYGON((13 -40,16 -40,16 -37,13 -37,13 -40))";
const DISTRICT_WKT =
  "POLYGON((10.5 -39.5,12.5 -39.5,12.5 -37.5,10.5 -37.5,10.5 -39.5),(11.4 -38.6,11.4 -38.4,11.6 -38.4,11.6 -38.6,11.4 -38.6))";
const CAP_POLYGON = "-39.5,10.5 -39.5,13.4 -37.5,13.4 -37.5,10.5 -39.5,10.5";
const CITY_POINT = { lon: 11.5, lat: -38.5 };

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "+00:00");

/** CAP как у редактора: три info (en/ru/tg), у области только контур и название района. */
function editorCap(id: string, names: [string, string, string]): string {
  const sent = new Date(Date.now() - H);
  const expires = new Date(Date.now() + 12 * H);
  const info = (lang: string, name: string) => `<info><language>${lang}</language>
    <category>Met</category><event>Rain ${run}</event><urgency>Expected</urgency>
    <severity>Severe</severity><certainty>Likely</certainty><onset>${iso(sent)}</onset>
    <expires>${iso(expires)}</expires><area><areaDesc>${name}</areaDesc>
    <polygon>${CAP_POLYGON}</polygon></area></info>`;
  return `<?xml version="1.0" encoding="UTF-8"?><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
    <identifier>${id}</identifier><sender>test@havo.tj</sender><sent>${iso(sent)}</sent>
    <status>Actual</status><msgType>Alert</msgType><scope>Public</scope>
    ${info("en-TJ", names[0])}${info("ru-TJ", names[1])}${info("tg-TJ", names[2])}</alert>`;
}

describe.skipIf(!url)("регион области CAP без геокода", () => {
  const db = createDb(url ?? "postgres://invalid", { max: 2 });
  const geom = (wkt: string) => sql`ST_Multi(ST_GeomFromText(${wkt}, 4326))`;

  beforeAll(async () => {
    const names: Array<[string, string, string, string, string]> = [
      [CITY, CITY_WKT, "Testshahr city", "Город Тестшахр", "Шаҳри Тестшаҳр"],
      [LAND, LAND_WKT, "Testland region", "Тестлендская область", "Вилояти Тестленд"],
      [NEXT, NEXT_WKT, "Nextland region", "Некстлендская область", "Вилояти Некстленд"],
    ];
    for (const [code, wkt, en, ru, tg] of names) {
      const name = JSON.stringify({ en, ru, tg });
      await db.execute(
        sql`insert into ${s.warningRegions} (code, name, geom) values (${code}, ${name}::jsonb, ${geom(wkt)})`,
      );
    }
    await db.execute(
      sql`insert into ${s.regions} (code, name) values (${LAND}, ${JSON.stringify({ en: "Testland" })}::jsonb)`,
    );
    const district = JSON.stringify({
      en: "Testobod district",
      ru: "Тестободский район",
      tg: "Ноҳияи Тестобод",
    });
    await db.execute(sql`
      insert into ${s.districts} (region_id, code, name, geom)
      select r.id, ${`D-${run}`}, ${district}::jsonb, ${geom(DISTRICT_WKT)}
      from ${s.regions} r where r.code = ${LAND}
    `);
  });

  afterAll(async () => {
    await db.delete(s.capAlerts).where(like(s.capAlerts.identifier, `${run}%`));
    await db.delete(s.capEventTranslations).where(like(s.capEventTranslations.event, `%${run}%`));
    await db.delete(s.districts).where(eq(s.districts.code, `D-${run}`));
    await db.delete(s.regions).where(eq(s.regions.code, LAND));
    await db.delete(s.warningRegions).where(inArray(s.warningRegions.code, [CITY, LAND, NEXT]));
    await db.$client.end();
  });

  const regionsOf = async (identifier: string) => {
    const rows = await db.execute<{ code: string }>(sql`
      select distinct wr.code from ${s.capAlerts} a
      join ${s.capInfos} ci on ci.alert_id = a.id
      join ${s.capAreas} ca on ca.info_id = ci.id
      join ${s.warningRegions} wr on wr.id = ca.warning_region_id
      where a.identifier = ${identifier} order by 1
    `);
    return [...rows].map((r) => r.code);
  };
  const ingest = (xml: string) =>
    ingestCapAlert(db, parseCapAlert(xml), { rawXml: xml, sourceUrl: null });

  it("по названию района: только его область, хотя контур накрывает город и задевает соседей", async () => {
    await ingest(editorCap(`${run}.named`, ["Testobod", "Тестобод", "Тестобод"]));
    expect(await regionsOf(`${run}.named`)).toEqual([LAND]);
  });

  it("неизвестное название - по геометрии: накрытый город есть, узкой полосы соседей нет", async () => {
    await ingest(editorCap(`${run}.geo`, ["Somewhere", "Где-то", "Ҷое"]));
    expect(await regionsOf(`${run}.geo`)).toEqual([CITY, LAND].sort());
  });

  it("страница города не получает предупреждение для района вокруг него", async () => {
    const warnings = (await loadWarnings(db, {})).filter((w) =>
      [`${run}.named`, `${run}.geo`].includes(w.identifier),
    );
    const idOf = (identifier: string) => warnings.find((w) => w.identifier === identifier)?.id;
    const inCity = await warningIdsForPoint(db, { ...CITY_POINT, regionCode: CITY }, warnings);
    expect(inCity.has(idOf(`${run}.named`) ?? -1)).toBe(false);
    expect(inCity.has(idOf(`${run}.geo`) ?? -1)).toBe(true);
    // Без кода региона точки решает контур.
    const byShape = await warningIdsForPoint(db, CITY_POINT, warnings);
    expect(byShape.has(idOf(`${run}.named`) ?? -1)).toBe(true);
  });
});
