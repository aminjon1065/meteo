/**
 * CAP в базе: замена Update/Cancel (в том числе в обратном порядке прихода), фильтр истечения и
 * сверка ленты SmartAlert (снятие пропавших предупреждений). Нужна база с миграциями:
 * TEST_DATABASE_URL=postgres://meteo:meteo@localhost:5432/meteo pnpm --filter @meteo/db test
 * Без TEST_DATABASE_URL тесты пропускаются; свои строки тест удаляет за собой.
 */
import { parseCapAlert } from "@meteo/core";
import { like } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "../client";
import * as s from "../schema";
import { ingestCapAlert, loadWarnings, reconcileCapFeed } from "../services/cap";

const url = process.env.TEST_DATABASE_URL;
const H = 3_600_000;
const run = `t${Date.now().toString(36)}`;
const SENDER = "test@havo.tj";

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "+00:00");

function capXml(o: {
  id: string;
  sent: Date;
  msgType: "Alert" | "Update" | "Cancel";
  refs?: Array<{ id: string; sent: Date }>;
  expires?: Date;
  event?: string;
}): string {
  const refs = o.refs?.length
    ? `<references>${o.refs.map((r) => `${SENDER},${r.id},${iso(r.sent)}`).join(" ")}</references>`
    : "";
  const info =
    o.msgType === "Cancel"
      ? ""
      : `<info><language>ru-RU</language><category>Met</category><event>${o.event ?? `Ветер ${run}`}</event>
         <urgency>Expected</urgency><severity>Moderate</severity><certainty>Likely</certainty>
         <onset>${iso(o.sent)}</onset>${o.expires ? `<expires>${iso(o.expires)}</expires>` : ""}
         <headline>Тест</headline><area><areaDesc>Тест</areaDesc></area></info>`;
  return `<?xml version="1.0" encoding="UTF-8"?><alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
    <identifier>${o.id}</identifier><sender>${SENDER}</sender><sent>${iso(o.sent)}</sent>
    <status>Actual</status><msgType>${o.msgType}</msgType><scope>Public</scope>${refs}${info}</alert>`;
}

describe.skipIf(!url)("CAP в базе", () => {
  const db = createDb(url ?? "postgres://invalid", { max: 2 });
  const ingest = (xml: string, sourceUrl: string | null = null) =>
    ingestCapAlert(db, parseCapAlert(xml), { rawXml: xml, sourceUrl });
  const ours = async (now = new Date()) =>
    (await loadWarnings(db, { now })).filter((w) => w.identifier.startsWith(run));

  afterAll(async () => {
    await db.delete(s.capAlerts).where(like(s.capAlerts.identifier, `${run}%`));
    await db.delete(s.capEventTranslations).where(like(s.capEventTranslations.event, `%${run}%`));
    await db.$client.end();
  });

  it("Update заменяет Alert, повторная загрузка идемпотентна", async () => {
    const t0 = new Date(Date.now() - H);
    const a = capXml({
      id: `${run}.a1`,
      sent: t0,
      msgType: "Alert",
      expires: new Date(t0.getTime() + 12 * H),
    });
    const first = await ingest(a);
    expect(first.inserted).toBe(true);
    expect((await ingest(a)).inserted).toBe(false);
    const u = capXml({
      id: `${run}.a2`,
      sent: new Date(t0.getTime() + 10 * 60_000),
      msgType: "Update",
      refs: [{ id: `${run}.a1`, sent: t0 }],
      expires: new Date(t0.getTime() + 24 * H),
    });
    expect((await ingest(u)).superseded).toBe(1);
    const ids = (await ours()).map((w) => w.identifier);
    expect(ids).toContain(`${run}.a2`);
    expect(ids).not.toContain(`${run}.a1`);
  });

  it("Cancel, пришедший раньше исходного Alert, сразу снимает Alert", async () => {
    const t0 = new Date(Date.now() - 2 * H);
    const cancel = capXml({
      id: `${run}.b2`,
      sent: new Date(t0.getTime() + 30 * 60_000),
      msgType: "Cancel",
      refs: [{ id: `${run}.b1`, sent: t0 }],
    });
    expect((await ingest(cancel)).superseded).toBe(0);
    const alert = await ingest(
      capXml({
        id: `${run}.b1`,
        sent: t0,
        msgType: "Alert",
        expires: new Date(t0.getTime() + 12 * H),
      }),
    );
    expect(alert.superseded).toBe(1);
    expect((await ours()).map((w) => w.identifier)).not.toContain(`${run}.b1`);
  });

  it("истёкшее предупреждение не публикуется", async () => {
    const t0 = new Date(Date.now() - 10 * H);
    await ingest(
      capXml({
        id: `${run}.c1`,
        sent: t0,
        msgType: "Alert",
        expires: new Date(t0.getTime() + 2 * H),
      }),
    );
    expect((await ours()).map((w) => w.identifier)).not.toContain(`${run}.c1`);
    // На момент «через час после выпуска» оно действовало.
    expect((await ours(new Date(t0.getTime() + H))).map((w) => w.identifier)).toContain(
      `${run}.c1`,
    );
  });

  it("сверка ленты: пропавшее из выпуска снимается, вернувшееся публикуется снова", async () => {
    const base = `http://feed-${run}/`;
    const t0 = new Date(Date.now() - H);
    const exp = new Date(t0.getTime() + 12 * H);
    const u1 = `${base}data/publishedCap/1/x_ALERT_1.xml`;
    const u2 = `${base}data/publishedCap/1/x_ALERT_2.xml`;
    await ingest(capXml({ id: `${run}.d1`, sent: t0, msgType: "Alert", expires: exp }), u1);
    await ingest(capXml({ id: `${run}.d2`, sent: t0, msgType: "Alert", expires: exp }), u2);
    // Чужая лента (другой адрес) не трогается.
    await ingest(
      capXml({ id: `${run}.d3`, sent: t0, msgType: "Alert", expires: exp }),
      `http://other-${run}/a.xml`,
    );

    const r1 = await reconcileCapFeed(db, { feedBase: base, presentUrls: [u1] });
    expect(r1).toEqual({ withdrawn: 1, restored: 0 });
    let ids = (await ours()).map((w) => w.identifier);
    expect(ids).toContain(`${run}.d1`);
    expect(ids).not.toContain(`${run}.d2`);
    expect(ids).toContain(`${run}.d3`);

    // Следующий выпуск редактора снова содержит d2 — уже по новому адресу: адрес обновляется.
    const u2b = `${base}data/publishedCap/2/y_ALERT_2.xml`;
    await ingest(capXml({ id: `${run}.d2`, sent: t0, msgType: "Alert", expires: exp }), u2b);
    const r2 = await reconcileCapFeed(db, { feedBase: base, presentUrls: [u1, u2b] });
    expect(r2).toEqual({ withdrawn: 0, restored: 1 });
    ids = (await ours()).map((w) => w.identifier);
    expect(ids).toEqual(expect.arrayContaining([`${run}.d1`, `${run}.d2`]));

    // Пустой выпуск (лента «нет предупреждений») снимает всё из этой ленты.
    const r3 = await reconcileCapFeed(db, { feedBase: base, presentUrls: [] });
    expect(r3.withdrawn).toBe(2);
    ids = (await ours()).map((w) => w.identifier);
    expect(ids).not.toContain(`${run}.d1`);
    expect(ids).toContain(`${run}.d3`);
  });
});
