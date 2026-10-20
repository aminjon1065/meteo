import { type EcoBulletinData, localDateOf, pollutantLabel, shiftIsoDate } from "@meteo/core";
import {
  computeEcoBulletin,
  ecoBulletins,
  emailOutbox,
  getEcoBulletinSettings,
  inArray,
  listBulletinStations,
  listEcoBulletinNoticeRecipients,
  listScheduledBulletinStations,
  localizedPath,
  upsertEcoBulletinDraft,
} from "@meteo/db";
import type { I18nText } from "@meteo/i18n";
import { db } from "../db";
import { env } from "../env";
import { logger } from "../logger";
import type { JobDefinition } from "./types";

export interface EcoBulletinDraftData {
  /** Местные сутки; по умолчанию — вчера (Asia/Dushanbe). */
  date?: string;
  /** Станции; по умолчанию — из настроек или все публичные автоматические. */
  stationIds?: number[];
  /** Выполнить, даже если расписание выключено в настройках. */
  force?: boolean;
  /** Переопределить настройку уведомлений. */
  notify?: boolean;
}

/** Элемент письма‑дайджеста: станция и её превышения на языке получателя. */
export interface EcoBulletinDraftItem {
  bulletinId: number;
  station: I18nText;
  code: string;
  hasData: boolean;
  exceedances: Record<"tg" | "ru", string>;
  url: Record<"tg" | "ru" | "en", string>;
}

/** Список превышений для письма: «диоксида азота (NO2), частиц 10 мкр. (РМ-10)». */
function exceedanceList(data: EcoBulletinData, lang: "tg" | "ru"): string {
  const ids = [
    ...data.cityStats.exceedances.both,
    ...data.cityStats.exceedances.dailyOnly,
    ...data.cityStats.exceedances.singleOnly,
  ];
  const byId = new Map(data.cityStats.rows.map((r) => [r.pollutant.id, r.pollutant]));
  return ids
    .map((id) => byId.get(id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => pollutantLabel(p, lang, "gen"))
    .join(", ");
}

/**
 * Черновик ежедневного экобюллетеня за прошедшие сутки: ежедневно в 08:00 по Душанбе
 * (данные за вчера уже полные), по станциям из настроек; операторам и администраторам —
 * одно письмо‑дайджест на дату со списком станций и превышений (dedup по дате и адресу).
 * Опубликованные бюллетени не перезаписываются.
 */
export const ecoBulletinDraft: JobDefinition<EcoBulletinDraftData> = {
  name: "eco-bulletin-draft",
  schedule: { pattern: "0 8 * * *", tz: "Asia/Dushanbe" },
  async run(job) {
    const settings = await getEcoBulletinSettings(db);
    if (!settings.scheduleEnabled && !job.data.force) {
      logger.info("eco-bulletin draft skipped: schedule disabled");
      return { skipped: "disabled" };
    }
    const date = job.data.date ?? shiftIsoDate(localDateOf(new Date()), -1);
    const stations = job.data.stationIds?.length
      ? (await listBulletinStations(db)).filter((st) =>
          (job.data.stationIds as number[]).includes(st.id),
        )
      : await listScheduledBulletinStations(db, settings);
    let created = 0;
    let updated = 0;
    const items: EcoBulletinDraftItem[] = [];
    for (const station of stations) {
      const data = await computeEcoBulletin(db, { date, stationId: station.id, settings });
      const result = await upsertEcoBulletinDraft(db, {
        date,
        stationId: station.id,
        data,
        generatedBy: "scheduler",
      });
      if (result.status === "published") continue;
      if (result.created) created += 1;
      else updated += 1;
      const path = `/admin/eco-bulletins/${result.id}`;
      items.push({
        bulletinId: result.id,
        station: station.name,
        code: station.code,
        hasData: data.cityStats.hasData,
        exceedances: { tg: exceedanceList(data, "tg"), ru: exceedanceList(data, "ru") },
        url: {
          tg: localizedPath(env.PUBLIC_URL, "tg", path),
          ru: localizedPath(env.PUBLIC_URL, "ru", path),
          en: localizedPath(env.PUBLIC_URL, "en", path),
        },
      });
    }
    const notify = job.data.notify ?? settings.notifyOperators;
    let emails = 0;
    if (notify && items.length > 0) {
      const recipients = await listEcoBulletinNoticeRecipients(db);
      if (recipients.length > 0) {
        const rows = recipients.map((r) => {
          const locale = (["tg", "ru", "en"].includes(r.locale) ? r.locale : "tg") as
            | "tg"
            | "ru"
            | "en";
          return {
            to: r.email,
            locale,
            template: "ecoBulletinDraft",
            payload: {
              date,
              items,
              journalUrl: localizedPath(env.PUBLIC_URL, locale, "/admin/eco-bulletins"),
            },
            dedupKey: `eco-bulletin:${date}:digest:${r.email.toLowerCase()}`,
          };
        });
        const inserted = await db
          .insert(emailOutbox)
          .values(rows)
          .onConflictDoNothing()
          .returning({ id: emailOutbox.id });
        emails = inserted.length;
        if (emails > 0)
          await db
            .update(ecoBulletins)
            .set({ notifiedAt: new Date() })
            .where(
              inArray(
                ecoBulletins.id,
                items.map((i) => i.bulletinId),
              ),
            );
      }
    }
    const summary = { date, stations: stations.length, created, updated, emails };
    logger.info(summary, "eco-bulletin drafts prepared");
    return summary;
  },
};
