import { and, desc, eq, gte, inArray, isNull } from "@meteo/db";
import { capAlerts, capInfos } from "@meteo/db/schema";
import { isLocale, type Locale } from "@meteo/i18n";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;
/** Больше записей в ленте не нужно: подписчики опрашивают её каждые 5–10 минут. */
const LIMIT = 200;

/** Язык блока <info> CAP по локали интерфейса: tg-TJ, ru-RU, en-US и короткие формы. */
const LANGUAGE_PREFIX: Record<Locale, string> = { tg: "tg", ru: "ru", en: "en" };

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/**
 * GET /api/v1/alerts/feed.atom?days=7&lang=tg — лента Atom CAP‑сообщений Агентства
 * (status=Actual) за последние дни: оповещения, уточнения и отмены. Каждая запись ссылается
 * на исходный XML (/api/v1/alerts/{id}/xml, application/cap+xml). Для подписчиков, которые
 * читают CAP лентой (Портал КЧС, агрегаторы): в отличие от /api/v1/alerts здесь есть и отмены,
 * иначе подписчик не узнал бы, что предупреждение снято. Снятые администратором с публикации
 * сообщения (withdrawn) в ленту не попадают. lang — язык заголовков записей.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const langRaw = sp.get("lang");
  const lang: Locale = isLocale(langRaw) ? langRaw : "tg";
  const days = Math.min(14, Math.max(1, Number(sp.get("days") ?? 7) || 7));
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const now = new Date();
  const since = new Date(now.getTime() - days * DAY);
  const db = getDb();

  const alerts = await db
    .select({
      id: capAlerts.id,
      identifier: capAlerts.identifier,
      sender: capAlerts.sender,
      sent: capAlerts.sent,
      msgType: capAlerts.msgType,
    })
    .from(capAlerts)
    .where(
      and(
        eq(capAlerts.status, "Actual"),
        gte(capAlerts.sent, since),
        isNull(capAlerts.withdrawnAt),
      ),
    )
    .orderBy(desc(capAlerts.sent))
    .limit(LIMIT);

  const infos =
    alerts.length > 0
      ? await db
          .select({
            alertId: capInfos.alertId,
            language: capInfos.language,
            event: capInfos.event,
            headline: capInfos.headline,
          })
          .from(capInfos)
          .where(
            inArray(
              capInfos.alertId,
              alerts.map((a) => a.id),
            ),
          )
      : [];

  /** Заголовок записи: блок на нужном языке, иначе первый; без заголовка — событие. */
  const titleOf = (alertId: number): string => {
    const own = infos.filter((i) => i.alertId === alertId);
    const preferred =
      own.find((i) => i.language.toLowerCase().startsWith(LANGUAGE_PREFIX[lang])) ?? own[0];
    return preferred?.headline?.trim() || preferred?.event || "";
  };

  const self = `${origin}/api/v1/alerts/feed.atom`;
  const updated = (alerts[0]?.sent ?? now).toISOString();
  const entries = alerts
    .map((a) => {
      const xml = `${origin}/api/v1/alerts/${a.id}/xml`;
      return `  <entry>
    <id>${esc(a.identifier)}</id>
    <title>${esc(`${titleOf(a.id)}${a.msgType === "Alert" ? "" : ` (${a.msgType})`}`)}</title>
    <updated>${a.sent.toISOString()}</updated>
    <author><name>${esc(a.sender)}</name></author>
    <category term="${esc(a.msgType)}"/>
    <link rel="alternate" type="application/cap+xml" href="${esc(xml)}"/>
  </entry>`;
    })
    .join("\n");

  const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>CAP — Агентство по гидрометеорологии Республики Таджикистан</title>
  <id>${esc(self)}</id>
  <updated>${updated}</updated>
  <link rel="self" type="application/atom+xml" href="${esc(self)}"/>
${entries}
</feed>
`;
  return new NextResponse(feed, {
    headers: {
      "Content-Type": "application/atom+xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
