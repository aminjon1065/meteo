import {
  FMI_SILAM_LAST_HOUR,
  FMI_SILAM_PRODUCTS,
  type FmiSilamCode,
  fmiSilamFrameTime,
  fmiSilamIsStale,
  fmiSilamNearestHour,
  fmiSilamRunId,
} from "@meteo/core/silam-fmi";
import type { Locale } from "@meteo/i18n";
import { AqBadge } from "@meteo/ui/components/aq-badge";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { FmiSilamViewer } from "@/components/air/fmi-silam-viewer";
import { PageHeader, Section } from "@/components/site/page-header";
import { Link } from "@/i18n/navigation";
import { loadFmiSilamCatalog } from "@/lib/silam-fmi";

export const dynamic = "force-dynamic";

const FMI_TAJ_URL = "https://silam.fmi.fi/roux/TAJ/";
const FMI_SILAM_URL = "https://silam.fmi.fi/";
const FMI_AQI_URL = "https://en.ilmatieteenlaitos.fi/air-quality-index";

/**
 * Пороги индекса FMI (часовые, мкг/м³) — легенда, на которую FMI ссылается со страницы TAJ.
 * Подписи — как на легенде карт FMI (английские), цвета совпадают с уровнями 1–5 портала.
 */
const FMI_AQI_LEVELS = [
  { level: 1, legend: "Good", SO2: "< 20", NO2: "< 40", PM10: "< 20", PM25: "< 10", O3: "< 60" },
  {
    level: 2,
    legend: "Fair",
    SO2: "20–80",
    NO2: "40–70",
    PM10: "20–50",
    PM25: "10–25",
    O3: "60–100",
  },
  {
    level: 3,
    legend: "Moderate",
    SO2: "80–250",
    NO2: "70–150",
    PM10: "50–100",
    PM25: "25–50",
    O3: "100–140",
  },
  {
    level: 4,
    legend: "Poor",
    SO2: "250–350",
    NO2: "150–200",
    PM10: "100–200",
    PM25: "50–75",
    O3: "140–180",
  },
  {
    level: 5,
    legend: "VeryPoor",
    SO2: "> 350",
    NO2: "> 200",
    PM10: "> 200",
    PM25: "> 75",
    O3: "> 180",
  },
] as const;
const AQI_POLLUTANTS = ["SO2", "NO2", "PM10", "PM25", "O3"] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "silamPage" });
  return { title: t("metaTitle"), description: t("intro") };
}

const TZ = "Asia/Dushanbe";

/**
 * Подписи часов прогона и местные сутки — на сервере: в Node есть данные Intl для tg, а в браузерах
 * (Chrome) нет, и там таджикская дата форматировалась бы по-английски.
 */
function frameLabels(locale: Locale, origin: Date) {
  const full = new Intl.DateTimeFormat(locale, {
    timeZone: TZ,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const day = new Intl.DateTimeFormat(locale, { timeZone: TZ, day: "numeric", month: "short" });
  const dayNum = new Intl.DateTimeFormat(locale, { timeZone: TZ, day: "numeric" });
  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, dateStyle: "short" });
  const times = Array.from({ length: FMI_SILAM_LAST_HOUR + 1 }, (_, h) =>
    fmiSilamFrameTime(origin, h),
  );
  const days: Array<{ key: string; first: number; last: number; label: string }> = [];
  times.forEach((time, h) => {
    const key = dayKey.format(time);
    const prev = days.at(-1);
    if (prev?.key === key) prev.last = h;
    else days.push({ key, first: h, last: h, label: "" });
  });
  for (const d of days) {
    // Короткие сутки (у края прогона — несколько часов) подписываются только числом.
    const first = times[d.first] ?? origin;
    d.label = d.last - d.first >= 8 ? day.format(first) : dayNum.format(first);
  }
  return { labels: times.map((time) => full.format(time)), days };
}

function isCode(value: string | undefined): value is FmiSilamCode {
  return FMI_SILAM_PRODUCTS.some((p) => p.code === value);
}

const external = (href: string) => (chunks: ReactNode) => (
  <a href={href} className="font-medium text-brand hover:underline" rel="noopener">
    {chunks}
  </a>
);
const internal = (href: string) => (chunks: ReactNode) => (
  <Link href={href} className="font-medium text-brand hover:underline">
    {chunks}
  </Link>
);

/**
 * «SmartMet (SILAM)»: карты прогноза SILAM, которые FMI строит для Таджикистана
 * (https://silam.fmi.fi/roux/TAJ/), с кнопками показателей и анимацией по часам — как у
 * data.meteo.uz, и пояснением, как читать карту, — как у meteo.kg. Картинки FMI идут через
 * /silam-fmi (CSP портала разрешает изображения только со своего адреса).
 */
export default async function SilamPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ param?: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const { param } = await searchParams;
  const [t, tl, tp, catalog] = await Promise.all([
    getTranslations("silamPage"),
    getTranslations("levels"),
    getTranslations("pollutants"),
    loadFmiSilamCatalog(),
  ]);
  const now = new Date();
  const origin = catalog ? new Date(catalog.originTime) : null;
  const initialCode: FmiSilamCode = isCode(param) ? param : "AQI";
  const nowHour =
    origin &&
    now.getTime() >= origin.getTime() &&
    fmiSilamNearestHour(origin, now) < FMI_SILAM_LAST_HOUR
      ? fmiSilamNearestHour(origin, now)
      : null;
  const frames = origin ? frameLabels(locale, origin) : null;
  const dateFmt = new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
  });
  const issuedFmt = new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Dushanbe",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="container-page flex flex-col gap-9 py-8">
      <PageHeader title={t("title")} intro={t("intro")}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm font-semibold">
          <Link href="/map?layer=silam" className="text-brand hover:underline">
            {t("linkMap")} →
          </Link>
          <Link href="/air" className="text-brand hover:underline">
            {t("linkStations")} →
          </Link>
        </div>
      </PageHeader>

      {catalog && origin ? (
        <div className="flex flex-col gap-2">
          {fmiSilamIsStale(origin, now) ? (
            <p
              className="rounded-lg border border-aq-3/40 bg-aq-3-tint px-3 py-2 text-sm"
              suppressHydrationWarning
            >
              {t("viewer.stale", { date: dateFmt.format(origin) })}
            </p>
          ) : null}
          <FmiSilamViewer
            frameLabels={frames?.labels ?? []}
            days={frames?.days ?? []}
            run={{ id: fmiSilamRunId(origin), originTime: catalog.originTime }}
            initialCode={initialCode}
            initialHour={nowHour ?? fmiSilamNearestHour(origin, now)}
            nowHour={nowHour}
          />
          <p className="text-xs text-muted-foreground" suppressHydrationWarning>
            {t("viewer.run", {
              date: dateFmt.format(origin),
              issued: issuedFmt.format(new Date(catalog.issuedAt)),
            })}
          </p>
        </div>
      ) : (
        <div
          className="flex flex-col items-start gap-3 rounded-xl border bg-card p-4"
          data-testid="silam-fmi-unavailable"
        >
          <p className="max-w-2xl">{t("viewer.unavailable")}</p>
          <Link
            href="/map?layer=silam"
            className="text-sm font-semibold text-brand hover:underline"
          >
            {t("linkMap")} →
          </Link>
        </div>
      )}

      <div className="grid gap-9 lg:grid-cols-2 lg:gap-x-12">
        <Section title={t("about.heading")} id="silam-about">
          <div className="flex max-w-3xl flex-col gap-3 text-pretty">
            <p>{t("about.p1")}</p>
            <p>{t("about.p2")}</p>
            <p>{t.rich("about.p3", { link: internal("/air") })}</p>
          </div>
        </Section>

        <Section title={t("read.heading")} id="silam-read">
          <ul className="flex max-w-3xl list-disc flex-col gap-2 pl-5 text-pretty marker:text-muted-foreground">
            {(["select", "time", "colors", "aqi", "abl", "map"] as const).map((key) => (
              <li key={key}>{t(`read.${key}`)}</li>
            ))}
          </ul>
        </Section>
      </div>

      <Section title={t("levels.heading")} id="silam-levels">
        <div className="flex flex-col gap-3">
          <p className="max-w-3xl text-pretty text-muted-foreground">{t("levels.intro")}</p>
          <div className="overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <caption className="sr-only">{t("levels.caption")}</caption>
              <thead>
                <tr className="border-b bg-surface-2/60 text-left text-caption text-muted-foreground">
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("levels.level")}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t("levels.legend")}
                  </th>
                  {AQI_POLLUTANTS.map((code) => (
                    <th
                      key={code}
                      scope="col"
                      className="px-3 py-2 text-right font-medium"
                      title={tp(code)}
                    >
                      {t(`products.${code}.label`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {FMI_AQI_LEVELS.map((row) => (
                  <tr key={row.level} className="border-b last:border-b-0">
                    <th scope="row" className="px-3 py-2 text-left font-medium">
                      <AqBadge level={row.level} label={tl(`${row.level}`)} size="sm" />
                    </th>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {row.legend}
                    </td>
                    {AQI_POLLUTANTS.map((code) => (
                      <td
                        key={code}
                        className="px-3 py-2 text-right whitespace-nowrap tabular-nums"
                      >
                        {row[code]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            {t.rich("levels.note", { link: internal("/air/index") })}{" "}
            {t.rich("levels.source", { link: external(FMI_AQI_URL) })}
          </p>
        </div>
      </Section>

      <div className="grid gap-9 lg:grid-cols-2 lg:gap-x-12">
        <Section title={t("portal.heading")} id="silam-portal">
          <div className="flex max-w-3xl flex-col gap-3 text-pretty">
            <p>{t.rich("portal.map", { link: internal("/map?layer=silam") })}</p>
            <p>{t("portal.stations")}</p>
          </div>
        </Section>
        <Section title={t("source.heading")} id="silam-source">
          <div className="flex max-w-3xl flex-col gap-3 text-pretty">
            <p>{t.rich("source.p1", { link: external(FMI_SILAM_URL) })}</p>
            <p>{t.rich("source.p2", { link: internal("/warnings") })}</p>
            <p className="text-sm">
              <a
                href={FMI_TAJ_URL}
                className="font-medium text-brand hover:underline"
                rel="noopener"
              >
                silam.fmi.fi/roux/TAJ
              </a>
            </p>
          </div>
        </Section>
      </div>
    </div>
  );
}
