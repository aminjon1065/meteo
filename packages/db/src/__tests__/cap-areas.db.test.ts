/**
 * Регион области CAP без геокода (как пишет редактор SmartMet Alert): по названию района, иначе по
 * геометрии со строгим порогом; страница города не получает предупреждение соседнего района.
 * Нужна база с миграциями, сидом и границами (districts, warning_regions.geom):
 * TEST_DATABASE_URL=postgres://meteo:meteo@localhost:5432/meteo pnpm --filter @meteo/db test
 * Без TEST_DATABASE_URL тесты пропускаются; свои строки тест удаляет за собой.
 */
import { parseCapAlert } from "@meteo/core";
import { like, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "../client";
import * as s from "../schema";
import { ingestCapAlert, loadWarnings, warningIdsForPoint } from "../services/cap";

const url = process.env.TEST_DATABASE_URL;
const H = 3_600_000;
const run = `t${Date.now().toString(36)}`;
const DUSHANBE = { lon: 68.787, lat: 38.5598 };

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "+00:00");

/** CAP как у редактора: три info (en/ru/tg), у области только контур и название района. */
function editorCap(id: string, names: [string, string, string], polygon: string): string {
  const sent = new Date(Date.now() - H);
  const expires = new Date(Date.now() + 12 * H);
  const info = (lang: string, name: string) => `<info><language>${lang}</language>
    <category>Met</category><event>Rain ${run}</event><urgency>Expected</urgency>
    <severity>Severe</severity><certainty>Likely</certainty><onset>${iso(sent)}</onset>
    <expires>${iso(expires)}</expires><area><areaDesc>${name}</areaDesc>
    <polygon>${polygon}</polygon></area></info>`;
  return `<?xml version="1.0" encoding="UTF-8"?><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
    <identifier>${id}</identifier><sender>test@havo.tj</sender><sent>${iso(sent)}</sent>
    <status>Actual</status><msgType>Alert</msgType><scope>Public</scope>
    ${info("en-TJ", names[0])}${info("ru-TJ", names[1])}${info("tg-TJ", names[2])}</alert>`;
}

describe.skipIf(!url)("регион области CAP без геокода", () => {
  const db = createDb(url ?? "postgres://invalid", { max: 2 });
  // Контур «Рудаки» у FMI накрывает и Душанбе - моделируем объединением района и города.
  let polygon = "";

  beforeAll(async () => {
    const rows = await db.execute<{ ring: string }>(sql`
      with u as (
        select ST_SimplifyPreserveTopology(ST_Union(d.geom, wr.geom), 0.005) as g
        from ${s.districts} d, ${s.warningRegions} wr
        where d.name->>'en' = 'Rudaki district' and wr.code = 'DU'
      ), big as (
        select part.geom as g from u, lateral ST_Dump(u.g) part
        order by ST_Area(part.geom) desc limit 1
      )
      select string_agg(ST_Y(p.geom)::text || ',' || ST_X(p.geom)::text, ' ' order by p.path) as ring
      from big, lateral ST_DumpPoints(ST_ExteriorRing(big.g)) p
    `);
    polygon = [...rows][0]?.ring ?? "";
  });

  afterAll(async () => {
    await db.delete(s.capAlerts).where(like(s.capAlerts.identifier, `${run}%`));
    await db.delete(s.capEventTranslations).where(like(s.capEventTranslations.event, `%${run}%`));
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

  it("по названию района: «Рудаки» - только РРП, хотя контур накрывает Душанбе", async () => {
    expect(polygon.split(" ").length).toBeGreaterThan(10);
    await ingest(editorCap(`${run}.rudaki`, ["Rudaki", "Рудаки", "Рўдакӣ"], polygon));
    expect(await regionsOf(`${run}.rudaki`)).toEqual(["RRP"]);
  });

  it("неизвестное название - по геометрии: накрытый город есть, узкой полосы соседей нет", async () => {
    await ingest(editorCap(`${run}.geo`, ["Somewhere", "Где-то", "Ҷое"], polygon));
    expect(await regionsOf(`${run}.geo`)).toEqual(["DU", "RRP"]);
  });

  it("страница Душанбе не получает предупреждение для района Рудаки", async () => {
    const warnings = (await loadWarnings(db, {})).filter((w) =>
      [`${run}.rudaki`, `${run}.geo`].includes(w.identifier),
    );
    const idOf = (identifier: string) => warnings.find((w) => w.identifier === identifier)?.id;
    const inDushanbe = await warningIdsForPoint(db, { ...DUSHANBE, regionCode: "DU" }, warnings);
    expect(inDushanbe.has(idOf(`${run}.rudaki`) ?? -1)).toBe(false);
    expect(inDushanbe.has(idOf(`${run}.geo`) ?? -1)).toBe(true);
    // Без кода региона точки решает контур.
    const byShape = await warningIdsForPoint(db, DUSHANBE, warnings);
    expect(byShape.has(idOf(`${run}.rudaki`) ?? -1)).toBe(true);
  });
});
