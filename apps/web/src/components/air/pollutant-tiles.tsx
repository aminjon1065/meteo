import type { AqLevelOrNone } from "@meteo/core";
import { AqBadge } from "@meteo/ui/components/aq-badge";
import { Sparkline } from "@meteo/ui/components/sparkline";
import { cn } from "@meteo/ui/lib/utils";
import { getFormatter, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { SeriesPoint } from "@/lib/api/measurement-series";
import type { PollutantInfo } from "@/lib/aq";

export interface PollutantTile {
  pollutant: PollutantInfo;
  /** Текущее значение (свежий индекс) либо последнее за сутки. */
  value: number | null;
  /** Время значения, если оно не из текущего окна индекса. */
  valueAt: Date | null;
  level: AqLevelOrNone;
  /** Часовые средние за последние 24 часа. */
  points: SeriesPoint[];
  /** Последнее измерение вообще, если за сутки данных нет. */
  lastEverAt?: Date | null;
}

export interface MissingTile {
  pollutant: PollutantInfo;
  nearest: { slug: string; name: string; distanceKm: number } | null;
}

const LEVEL_STROKE: Record<AqLevelOrNone, string> = {
  0: "var(--aq-0)",
  1: "var(--aq-1)",
  2: "var(--aq-2)",
  3: "var(--aq-3)",
  4: "var(--aq-4)",
  5: "var(--aq-5)",
  6: "var(--aq-6)",
};

/**
 * Плитки веществ (макет 2): короткое имя с подсказкой, плашка уровня, значение, мини‑график
 * за сутки, мин/макс. Пустые состояния — человеческие: что не измеряется и где измеряется.
 */
export async function PollutantTiles({
  tiles,
  missing,
  className,
}: {
  tiles: PollutantTile[];
  missing: MissingTile[];
  className?: string;
}) {
  const [t, tl, tp, format] = await Promise.all([
    getTranslations("station"),
    getTranslations("levels"),
    getTranslations("pollutantHints"),
    getFormatter(),
  ]);
  const num = (v: number | null, decimals: number) =>
    v === null ? "—" : format.number(v, { maximumFractionDigits: decimals });
  const hint = (code: string) => (tp.has(code as "PM10") ? tp(code as "PM10") : undefined);
  const tileClass = "grid content-start gap-1 rounded-xl border bg-card px-3.5 py-3";
  return (
    <ul
      className={cn("grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4", className)}
      data-testid="pollutant-tiles"
    >
      {tiles.map((tile) => {
        const values = tile.points.map((p) => p.v);
        const finite = values.filter((v): v is number => v !== null);
        const min = finite.length ? Math.min(...finite) : null;
        const max = finite.length ? Math.max(...finite) : null;
        const unit = tile.pollutant.unit;
        return (
          <li
            key={tile.pollutant.id}
            className={tileClass}
            data-testid={`tile-${tile.pollutant.code}`}
          >
            <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
              <abbr
                title={hint(tile.pollutant.code)}
                className="font-medium text-foreground no-underline decoration-dotted"
              >
                {tile.pollutant.shortName}
              </abbr>
              {tile.value !== null ? (
                <AqBadge level={tile.level} label={tl(`${tile.level}` as "0")} size="sm" />
              ) : null}
            </div>
            <div className="flex items-baseline gap-1.5">
              <b
                className={cn(
                  "num font-heading text-[1.6rem] leading-none font-bold",
                  tile.value === null && "text-muted-foreground",
                )}
              >
                {tile.value === null ? t("noDataValue") : num(tile.value, tile.pollutant.decimals)}
              </b>
              {tile.value !== null ? (
                <small className="text-caption text-muted-foreground">{unit}</small>
              ) : null}
            </div>
            {finite.length >= 2 ? (
              <Sparkline
                values={values}
                stroke={LEVEL_STROKE[tile.level]}
                label={t("sparklineLabel", {
                  pollutant: tile.pollutant.shortName,
                  min: num(min, tile.pollutant.decimals),
                  max: num(max, tile.pollutant.decimals),
                  unit,
                })}
              />
            ) : null}
            <p className="text-caption text-muted-foreground">
              {finite.length >= 2
                ? t("dayRange", {
                    min: num(min, tile.pollutant.decimals),
                    max: num(max, tile.pollutant.decimals),
                  })
                : tile.value !== null && tile.valueAt
                  ? t("lastValueAt", {
                      time: format.dateTime(tile.valueAt, {
                        day: "numeric",
                        month: "long",
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                    })
                  : tile.lastEverAt
                    ? `${t("noRecent")} ${t("lastValueAt", {
                        time: format.dateTime(tile.lastEverAt, { day: "numeric", month: "long" }),
                      })}`
                    : t("neverReported")}
            </p>
            {tile.valueAt && finite.length >= 2 ? (
              <p className="text-caption text-muted-foreground">
                {t("lastValueAt", {
                  time: format.dateTime(tile.valueAt, { hour: "2-digit", minute: "2-digit" }),
                })}
              </p>
            ) : null}
          </li>
        );
      })}
      {missing.map((m) => (
        <li
          key={`missing-${m.pollutant.id}`}
          className={cn(tileClass, "border-dashed bg-surface-2")}
          data-testid={`tile-missing-${m.pollutant.code}`}
        >
          <div className="text-caption text-muted-foreground">
            <abbr
              title={hint(m.pollutant.code)}
              className="font-medium text-foreground no-underline"
            >
              {m.pollutant.shortName}
            </abbr>
          </div>
          <b className="font-heading text-[1.25rem] leading-none font-bold text-muted-foreground">
            {t("noDataValue")}
          </b>
          <p className="text-caption text-muted-foreground">
            {t("notMeasured", { pollutant: m.pollutant.shortName })}{" "}
            {m.nearest ? (
              <>
                {t("nearestWith")}{" "}
                <Link
                  href={`/air/stations/${m.nearest.slug}`}
                  className="font-medium text-foreground hover:underline"
                >
                  {m.nearest.name}
                </Link>{" "}
                ({format.number(m.nearest.distanceKm, { maximumFractionDigits: 1 })} {t("km")}).
              </>
            ) : (
              t("noNearest")
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}
