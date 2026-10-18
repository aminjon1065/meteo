/**
 * Оценка правил уведомлений: открывает/закрывает события превышения и ставит письма в очередь.
 */
import { randomUUID } from "node:crypto";
import { windowMean } from "@meteo/core";
import type { I18nText } from "@meteo/i18n";
import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import type { Database } from "../client";
import * as s from "../schema";
import { getCurrentIndexes, loadIndexConfig } from "./station-index";

const HOUR = 3_600_000;

export interface EvaluateOptions {
  now?: Date;
  /** Базовый URL портала для ссылок в письмах. */
  publicUrl: string;
}

export interface EvaluateSummary {
  rules: number;
  opened: number;
  resolved: number;
  emailsQueued: number;
}

function floorHour(d: Date): Date {
  return new Date(Math.floor(d.getTime() / HOUR) * HOUR);
}

export async function evaluateAlertRules(
  db: Database,
  opts: EvaluateOptions,
): Promise<EvaluateSummary> {
  const now = opts.now ?? new Date();
  const rules = await db.select().from(s.alertRules).where(eq(s.alertRules.enabled, true));
  const summary: EvaluateSummary = { rules: rules.length, opened: 0, resolved: 0, emailsQueued: 0 };
  if (rules.length === 0) return summary;

  const stationRows = await db
    .select({
      id: s.stations.id,
      slug: s.stations.slug,
      code: s.stations.code,
      name: s.stations.name,
      regionId: s.stations.regionId,
    })
    .from(s.stations)
    .where(and(eq(s.stations.isPublic, true), ne(s.stations.status, "decommissioned")));
  const pollutantRows = await db.select().from(s.pollutants);
  const pollutantById = new Map(pollutantRows.map((p) => [p.id, p]));
  const config = await loadIndexConfig(db);

  // Часовые средние за последние 25 часов по всем веществам правил.
  const pollutantIds = [
    ...new Set(
      rules
        .filter((r) => r.kind === "pollutant" && r.pollutantId)
        .map((r) => r.pollutantId as number),
    ),
  ];
  const hourly = pollutantIds.length
    ? await db
        .select({
          bucket: sql<Date>`time_bucket(interval '1 hour', ${s.measurements.time})`.mapWith(
            (v) => new Date(v),
          ),
          stationId: s.measurements.stationId,
          pollutantId: s.measurements.pollutantId,
          value: sql<number>`avg(${s.measurements.value})`.mapWith(Number),
        })
        .from(s.measurements)
        .where(
          and(
            inArray(s.measurements.pollutantId, pollutantIds),
            gte(s.measurements.time, new Date(now.getTime() - 25 * HOUR)),
            sql`${s.measurements.qcFlag} in (1, 4)`,
            sql`${s.measurements.value} is not null`,
          ),
        )
        .groupBy(sql`1`, s.measurements.stationId, s.measurements.pollutantId)
    : [];
  const series = new Map<string, Array<{ time: Date; value: number }>>();
  for (const h of hourly) {
    const key = `${h.stationId}|${h.pollutantId}`;
    const list = series.get(key) ?? [];
    list.push({ time: h.bucket, value: h.value });
    series.set(key, list);
  }
  const indexCache = new Map<number, Awaited<ReturnType<typeof getCurrentIndexes>>>();
  const activeEvents = await db
    .select()
    .from(s.alertEvents)
    .where(eq(s.alertEvents.status, "active"));
  const activeByKey = new Map(activeEvents.map((e) => [`${e.ruleId}|${e.stationId}`, e]));

  const subscriberRows = await db
    .select()
    .from(s.subscribers)
    .where(eq(s.subscribers.status, "confirmed"));
  const end = floorHour(now);

  for (const rule of rules) {
    const targets = stationRows.filter((st) => {
      if (rule.scope === "station") return st.id === rule.stationId;
      if (rule.scope === "region") return st.regionId === rule.regionId;
      return true;
    });
    for (const st of targets) {
      let current: number | null = null;
      let level: number | null = null;
      if (rule.kind === "pollutant" && rule.pollutantId) {
        // Оцениваем по последнему доступному часу (не старше 6 ч): посты с разовыми пробами
        // не имеют данных в текущем часе, но превышение по последней пробе всё равно актуально.
        const points = (series.get(`${st.id}|${rule.pollutantId}`) ?? []).filter(
          (p) => p.time.getTime() <= end.getTime(),
        );
        const latest = points.reduce<Date | null>(
          (acc, p) => (acc === null || p.time > acc ? p.time : acc),
          null,
        );
        if (latest && end.getTime() - latest.getTime() <= 6 * HOUR) {
          current = windowMean(points, latest, rule.averagingMin);
        }
      } else if (rule.kind === "index" && rule.scaleId) {
        const scale = config.scales.find((sc) => sc.id === rule.scaleId);
        if (!scale) continue;
        let cached = indexCache.get(scale.id);
        if (!cached) {
          cached = await getCurrentIndexes(db, { scaleCode: scale.code });
          indexCache.set(scale.id, cached);
        }
        const idx = cached.byStation.get(st.id);
        if (idx && !idx.stale) {
          current = idx.level;
          level = idx.level;
        }
      }
      const key = `${rule.id}|${st.id}`;
      const active = activeByKey.get(key);
      const exceeded = current !== null && current >= rule.threshold;

      if (exceeded && !active) {
        // cooldown: не открываем новое событие, если предыдущее закрылось недавно
        const recent = await db
          .select({ endedAt: s.alertEvents.endedAt })
          .from(s.alertEvents)
          .where(
            and(
              eq(s.alertEvents.ruleId, rule.id),
              eq(s.alertEvents.stationId, st.id),
              eq(s.alertEvents.status, "resolved"),
            ),
          )
          .orderBy(sql`${s.alertEvents.endedAt} desc`)
          .limit(1);
        const lastEnd = recent[0]?.endedAt;
        if (lastEnd && now.getTime() - lastEnd.getTime() < rule.cooldownMin * 60_000) continue;
        const [event] = await db
          .insert(s.alertEvents)
          .values({
            ruleId: rule.id,
            stationId: st.id,
            startedAt: now,
            peakValue: current,
            lastValue: current,
            level,
            status: "active",
          })
          .returning();
        if (!event) continue;
        activeByKey.set(key, event);
        summary.opened += 1;
        if (rule.channels.includes("email")) {
          const recipients = subscriberRows.filter((sub) => {
            const t = sub.topics;
            return (
              t.all ||
              t.stations?.includes(st.id) ||
              (st.regionId !== null && t.regions?.includes(st.regionId))
            );
          });
          const pollutant = rule.pollutantId ? pollutantById.get(rule.pollutantId) : undefined;
          for (const sub of recipients) {
            const payload = {
              ruleName: rule.name,
              stationName: st.name as I18nText,
              stationSlug: st.slug,
              kind: rule.kind,
              pollutant: pollutant
                ? {
                    code: pollutant.code,
                    shortName: pollutant.shortName,
                    unit: pollutant.unit,
                    name: pollutant.name,
                  }
                : null,
              value: current,
              threshold: rule.threshold,
              level,
              startedAt: now.toISOString(),
              stationUrl: `${opts.publicUrl}/${sub.locale === "tg" ? "" : `${sub.locale}/`}air/stations/${st.slug}`,
              unsubscribeUrl: `${opts.publicUrl}/${sub.locale === "tg" ? "" : `${sub.locale}/`}subscribe/unsubscribe?token=${sub.unsubscribeToken}`,
            };
            await db
              .insert(s.emailOutbox)
              .values({
                to: sub.email,
                locale: sub.locale,
                template: "alert",
                payload,
                dedupKey: `alert:${event.id}:${sub.id}`,
              })
              .onConflictDoNothing();
            summary.emailsQueued += 1;
          }
          await db
            .update(s.alertEvents)
            .set({ notifiedAt: now })
            .where(eq(s.alertEvents.id, event.id));
        }
      } else if (exceeded && active) {
        const peak = Math.max(active.peakValue ?? Number.NEGATIVE_INFINITY, current as number);
        await db
          .update(s.alertEvents)
          .set({ peakValue: peak, lastValue: current, level })
          .where(eq(s.alertEvents.id, active.id));
      } else if (!exceeded && active && current !== null) {
        await db
          .update(s.alertEvents)
          .set({ status: "resolved", endedAt: now, lastValue: current })
          .where(eq(s.alertEvents.id, active.id));
        activeByKey.delete(key);
        summary.resolved += 1;
      }
    }
  }
  return summary;
}

/** Токен подписки/отписки. */
export function subscriptionToken(): string {
  return randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "").slice(0, 8);
}
