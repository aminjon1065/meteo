import { AQ_LEVELS_FIVE, type AqLevelOrNone } from "@meteo/core";
import type { Locale } from "@meteo/i18n";
import { AQ_DOT_CLASS, AqBadge, type AqLevelValue } from "@meteo/ui/components/aq-badge";
import { cn } from "@meteo/ui/lib/utils";
import { ChevronRightIcon } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { WeatherSymbol } from "@/components/weather/weather-symbol";
import { Link } from "@/i18n/navigation";
import type { CityAir } from "@/lib/city-air";
import { name } from "@/lib/format";
import { type LocationOverview, symbolLabel } from "@/lib/weather";

type Formatter = Awaited<ReturnType<typeof getFormatter>>;

/** Время для подписи «обновлено»: сегодня — только часы, иначе с датой. */
export function shortTime(format: Formatter, date: Date, now = new Date()): string {
  const day = (d: Date) =>
    format.dateTime(d, { year: "numeric", month: "2-digit", day: "2-digit" });
  return day(date) === day(now)
    ? format.dateTime(date, { hour: "2-digit", minute: "2-digit" })
    : format.dateTime(date, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * Шкала уровней — она же легенда цветов карты: сегменты всех уровней публичной шкалы, текущий
 * выделен (выше, с обводкой), подписи крайних уровней под шкалой, полный список — для экранных
 * дикторов. `level` 0 — ничего не выделено (легенда прогноза, город без данных).
 */
export async function LevelGauge({
  level = 0,
  levels,
  className,
}: {
  level?: AqLevelOrNone;
  levels?: readonly number[];
  className?: string;
}) {
  const [tl, tc] = await Promise.all([getTranslations("levels"), getTranslations("common")]);
  const shown = (levels?.length ? levels : AQ_LEVELS_FIVE) as readonly AqLevelValue[];
  const first = shown[0] ?? 1;
  const last = shown[shown.length - 1] ?? 5;
  return (
    <div className={className} data-testid="level-gauge">
      <div aria-hidden="true" className="flex h-3 items-center gap-0.5">
        {shown.map((l) => (
          <span
            key={l}
            title={tl(`${l}` as "1")}
            className={cn(
              "block flex-1 rounded-full",
              AQ_DOT_CLASS[l],
              l === level ? "h-3 ring-2 ring-card ring-offset-0" : "h-1.5",
              level > 0 && l !== level && "opacity-45",
            )}
          />
        ))}
      </div>
      <div
        aria-hidden="true"
        className="mt-1 flex justify-between gap-2 text-[11px] leading-tight text-muted-foreground"
      >
        <span>{tl(`${first}` as "1")}</span>
        <span className="text-right">{tl(`${last}` as "1")}</span>
      </div>
      <ul className="sr-only" aria-label={tc("legend")}>
        {shown.map((l) => (
          <li key={l}>{tl(`${l}` as "1")}</li>
        ))}
      </ul>
    </div>
  );
}

const moreLink =
  "inline-flex items-center gap-0.5 text-sm font-semibold text-brand hover:underline underline-offset-4";

/**
 * Карточка «Качество воздуха сейчас» для города из шапки: уровень словом и цветом, определяющее
 * вещество, время обновления, шкала-легенда. Без станций в городе — ближайшая станция с данными.
 */
export async function CityAirCard({
  cityName,
  air,
  scaleLevels,
  locale,
}: {
  cityName: string;
  air: CityAir | null;
  scaleLevels?: readonly number[];
  locale: Locale;
}) {
  const [t, tl, format] = await Promise.all([
    getTranslations("map"),
    getTranslations("levels"),
    getFormatter(),
  ]);
  const level = air?.level ?? 0;
  const dominant = air?.dominant;
  const chip = dominant ? air?.chips.find((c) => c.pollutant.id === dominant.id) : undefined;
  const value = chip
    ? format.number(chip.value, { maximumFractionDigits: chip.pollutant.decimals })
    : null;
  const valueText =
    chip && value !== null
      ? `${chip.pollutant.shortName} ${(air?.fresh.length ?? 0) > 1 ? t("card.upTo", { value }) : value} ${chip.pollutant.unit}`
      : null;

  let note: string | null = null;
  if (air && air.stations.length === 0) {
    note = air.nearest
      ? t("card.nearest", {
          station: name(air.nearest.station.name, locale),
          distance: format.number(air.nearest.distanceKm, { maximumFractionDigits: 0 }),
        })
      : t("card.noStations");
  } else if (air && air.fresh.length === 0) {
    note = air.lastAt
      ? t("card.noFresh", { time: shortTime(format, air.lastAt) })
      : t("card.noFreshEver");
  }

  return (
    <section
      aria-labelledby="city-card-title"
      data-testid="city-air"
      className="flex flex-col gap-2"
    >
      <p className="eyebrow hidden md:block">{t("card.airNow")}</p>
      <div className="flex items-center justify-between gap-3">
        <h2 id="city-card-title" className="font-heading text-base font-bold md:text-lg">
          {cityName}
        </h2>
        <AqBadge level={level} label={tl(`${level}` as "0")} size="md" className="md:hidden" />
      </div>
      <AqBadge
        level={level}
        label={tl(`${level}` as "0")}
        size="lg"
        className="hidden self-start md:inline-flex"
      />
      {valueText || air?.updatedAt ? (
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          {valueText ? <span className="num font-semibold">{valueText}</span> : null}
          {air?.updatedAt ? (
            <span className="text-xs text-muted-foreground">
              {t("card.updated", { time: shortTime(format, air.updatedAt) })}
            </span>
          ) : null}
        </p>
      ) : null}
      {note ? <p className="text-sm leading-snug text-muted-foreground">{note}</p> : null}
      <LevelGauge level={level} levels={scaleLevels} className="mt-1" />
      <Link href="/air" className={cn(moreLink, "self-start")}>
        {t("card.airMore")}
        <ChevronRightIcon className="size-4" aria-hidden="true" />
      </Link>
    </section>
  );
}

/** Карточка «Погода сейчас»: значок, температура, описание, макс/мин за сутки, ссылка на прогноз. */
export async function CityWeatherCard({
  cityName,
  overview,
  locale,
}: {
  cityName: string;
  overview: LocationOverview | null;
  locale: Locale;
}) {
  const [t, tw, tsym, format] = await Promise.all([
    getTranslations("map"),
    getTranslations("weather"),
    getTranslations("weatherSymbols"),
    getFormatter(),
  ]);
  const deg = (v: number | null | undefined) =>
    v === null || v === undefined ? null : `${format.number(v, { maximumFractionDigits: 0 })}°`;
  const now = overview?.now?.params;
  const code = now?.symbol ?? overview?.today?.symbol ?? null;
  const label = code !== null && code !== undefined ? symbolLabel(tsym, code) : null;
  const temp = deg(now?.t);
  const maxMin = overview?.today
    ? tw("maxMin", { max: deg(overview.today.tmax) ?? "—", min: deg(overview.today.tmin) ?? "—" })
    : null;
  const wind =
    now?.ws !== null && now?.ws !== undefined
      ? tw("windShort", { value: format.number(now.ws, { maximumFractionDigits: 0 }) })
      : null;
  const slug = overview?.location.slug;
  return (
    <section
      aria-labelledby="city-weather-title"
      data-testid="city-weather-card"
      className="flex flex-col gap-2"
      lang={locale}
    >
      <p className="eyebrow hidden md:block">{t("card.weatherNow")}</p>
      <h2 id="city-weather-title" className="font-heading text-base font-bold md:text-lg">
        {cityName}
      </h2>
      {temp || label ? (
        <div className="flex items-center gap-3">
          <WeatherSymbol code={code} label={label ?? ""} className="size-11 md:size-14" />
          {temp ? <span className="num text-3xl font-bold md:text-4xl">{temp}</span> : null}
          {label ? <span className="text-sm leading-snug">{label}</span> : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{tw("noForecastShort")}</p>
      )}
      {maxMin || wind ? (
        <p className="text-sm text-muted-foreground">
          {[maxMin, wind].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      {slug ? (
        <Link href={`/weather/${slug}`} className={cn(moreLink, "self-start")}>
          {tw("openForecast")}
          <ChevronRightIcon className="size-4" aria-hidden="true" />
        </Link>
      ) : null}
    </section>
  );
}
