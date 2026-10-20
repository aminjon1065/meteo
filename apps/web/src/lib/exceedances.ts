import "server-only";
import { and, desc, eq } from "@meteo/db";
import { alertEvents, alertRules, pollutants, stations } from "@meteo/db/schema";
import { getDb } from "@/lib/db";

/** Активные превышения порогов (портальный канал уведомлений). */
export async function loadActiveExceedances(stationId?: number) {
  const conditions = [eq(alertEvents.status, "active")];
  if (stationId) conditions.push(eq(alertEvents.stationId, stationId));
  return getDb()
    .select({
      id: alertEvents.id,
      startedAt: alertEvents.startedAt,
      peakValue: alertEvents.peakValue,
      lastValue: alertEvents.lastValue,
      level: alertEvents.level,
      ruleName: alertRules.name,
      kind: alertRules.kind,
      threshold: alertRules.threshold,
      channels: alertRules.channels,
      stationId: stations.id,
      stationSlug: stations.slug,
      stationName: stations.name,
      pollutant: pollutants.shortName,
      pollutantCode: pollutants.code,
      unit: pollutants.unit,
      decimals: pollutants.decimals,
    })
    .from(alertEvents)
    .innerJoin(alertRules, eq(alertRules.id, alertEvents.ruleId))
    .innerJoin(stations, eq(stations.id, alertEvents.stationId))
    .leftJoin(pollutants, eq(pollutants.id, alertRules.pollutantId))
    .where(and(...conditions, eq(stations.isPublic, true)))
    .orderBy(desc(alertEvents.startedAt))
    .limit(20);
}
