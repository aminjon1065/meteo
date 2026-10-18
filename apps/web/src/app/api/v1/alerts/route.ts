import { isLocale, type Locale } from "@meteo/i18n";
import { type NextRequest, NextResponse } from "next/server";
import { type LocalizedWarning, loadLocalizedWarnings } from "@/lib/warnings";

export const dynamic = "force-dynamic";

const HEADERS = {
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
  "Access-Control-Allow-Origin": "*",
};

function toJson(w: LocalizedWarning, origin: string) {
  return {
    id: w.id,
    identifier: w.identifier,
    sent: w.sent.toISOString(),
    msgType: w.msgType,
    language: w.language,
    event: w.eventName,
    headline: w.headline,
    description: w.description,
    instruction: w.instruction,
    severity: w.severity,
    color: w.style.key,
    colorHex: w.style.color,
    urgency: w.urgency,
    certainty: w.certainty,
    effective: w.effective?.toISOString() ?? null,
    onset: w.onset?.toISOString() ?? null,
    expires: w.expires?.toISOString() ?? null,
    start: w.start.toISOString(),
    end: w.end?.toISOString() ?? null,
    active: w.active,
    upcoming: w.upcoming,
    regions: w.regions.map((r) => ({ code: r.code, name: r.name })),
    areas: w.areaDescs,
    web: w.web,
    xml: `${origin}/api/v1/alerts/${w.id}/xml`,
  };
}

/** Один полигон на область: собственная геометрия один раз, региональная — на регион. */
function features(w: LocalizedWarning, href: string) {
  const seen = new Set<string>();
  const out = [];
  for (const a of w.areas) {
    if (!a.geometry) continue;
    const key = a.hasGeometry ? `own:${a.areaDesc}` : `region:${a.regionCode ?? a.areaDesc}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      type: "Feature" as const,
      id: `${w.id}-${a.id}`,
      geometry: a.geometry,
      properties: {
        id: w.id,
        identifier: w.identifier,
        event: w.eventName,
        headline: w.headline,
        severity: w.severity,
        level: w.style.level,
        color: w.style.color,
        start: w.start.toISOString(),
        end: w.end?.toISOString() ?? null,
        active: w.active,
        region: a.regionCode,
        areaDesc: a.areaDesc,
        href,
      },
    });
  }
  return out;
}

/**
 * GET /api/v1/alerts?active=1&region=DU&lang=tg&days=7&format=geojson
 * CAP‑предупреждения в нормализованном JSON (один блок info на язык с фолбэком) или GeoJSON
 * для карты; ссылка на исходный XML — /api/v1/alerts/{id}/xml. Кэш 60 с, CORS открыт.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const langRaw = sp.get("lang");
  const lang: Locale = isLocale(langRaw) ? langRaw : "tg";
  const activeOnly = sp.get("active") === "1";
  const region = sp.get("region")?.trim().toUpperCase() || undefined;
  const days = Math.min(14, Math.max(1, Number(sp.get("days") ?? 7) || 7));
  const geojson = sp.get("format") === "geojson";
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const now = new Date();
  const list = (
    await loadLocalizedWarnings(lang, {
      now,
      horizonDays: days,
      regionCode: region,
      withGeometry: geojson,
    })
  ).filter((w) => !activeOnly || w.active);
  if (geojson) {
    const href = `${origin}${lang === "tg" ? "" : `/${lang}`}/warnings`;
    return NextResponse.json(
      {
        type: "FeatureCollection",
        generatedAt: now.toISOString(),
        features: list.flatMap((w) => features(w, href)),
      },
      { headers: HEADERS },
    );
  }
  return NextResponse.json(
    {
      generatedAt: now.toISOString(),
      lang,
      count: list.length,
      alerts: list.map((w) => toJson(w, origin)),
    },
    { headers: HEADERS },
  );
}
