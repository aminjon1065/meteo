import { type AqLevel, clampAqLevel } from "@meteo/core";
import { asc, eq } from "@meteo/db";
import { healthAdvice, indexScales } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { AQ_TINT_CLASS, AqBadge } from "@meteo/ui/components/aq-badge";
import { cn } from "@meteo/ui/lib/utils";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageHeader } from "@/components/site/page-header";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";

export const dynamic = "force-dynamic";
const AUDIENCES = ["general", "children", "pregnant", "elderly", "respiratory", "cardio"] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "health" });
  return { title: t("title"), description: t("intro") };
}

/** Здоровье: рекомендации по уровням — секция на уровень с лёгкой заливкой его цвета. */
export default async function HealthPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const db = getDb();
  const [t, tl, scale] = await Promise.all([
    getTranslations("health"),
    getTranslations("levels"),
    db.query.indexScales.findFirst({ where: eq(indexScales.isDefaultPublic, true) }) ??
      db
        .select()
        .from(indexScales)
        .orderBy(asc(indexScales.sortOrder))
        .limit(1)
        .then((r) => r[0]),
  ]);
  const entries = scale
    ? await db.select().from(healthAdvice).where(eq(healthAdvice.scaleId, scale.id))
    : [];
  const levels = scale?.levels ?? [];

  return (
    <div className="container-page flex flex-col gap-8 py-8">
      <PageHeader title={t("title")} intro={t("intro")}>
        <p className="text-sm text-muted-foreground">{t("disclaimer")}</p>
        <nav aria-label={t("levelsNav")} className="flex flex-wrap gap-2">
          {levels.map((lv) => {
            const level = (clampAqLevel(lv.level) || 1) as AqLevel;
            return (
              <a key={lv.level} href={`#level-${level}`} className="rounded-full">
                <AqBadge level={level} label={tl(`${level}` as "1")} size="sm" />
              </a>
            );
          })}
        </nav>
      </PageHeader>
      <div className="flex flex-col gap-5">
        {levels.map((lv) => {
          const forLevel = entries.filter((e) => e.level === lv.level);
          const level = (clampAqLevel(lv.level) || 1) as AqLevel;
          const general = forLevel.find((e) => e.audience === "general");
          const groups = AUDIENCES.filter(
            (a) => a !== "general" && forLevel.some((e) => e.audience === a),
          );
          return (
            <section
              key={lv.level}
              id={`level-${level}`}
              aria-labelledby={`level-${level}-title`}
              className="scroll-mt-20 overflow-hidden rounded-xl border bg-card"
            >
              <div
                className={cn(
                  "flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5",
                  AQ_TINT_CLASS[level],
                )}
              >
                <h2 id={`level-${level}-title`} className="text-h2">
                  {tl(`${level}` as "1")}
                </h2>
                <span className="text-sm text-muted-foreground">
                  {t("levelOf", { level, total: levels.length })}
                </span>
                {general && name(general.text, locale) ? (
                  <p className="basis-full text-[1.02rem] text-pretty">
                    {name(general.text, locale)}
                  </p>
                ) : null}
              </div>
              {forLevel.length === 0 ? (
                <p className="px-4 py-4 text-sm text-muted-foreground sm:px-5">{t("noAdvice")}</p>
              ) : groups.length > 0 ? (
                <dl className="grid gap-x-6 gap-y-4 px-4 py-4 sm:px-5 md:grid-cols-2 lg:grid-cols-3">
                  {groups.map((a) => {
                    const e = forLevel.find((x) => x.audience === a);
                    if (!e) return null;
                    return (
                      <div key={a}>
                        <dt className="eyebrow">{t(`audience.${a}`)}</dt>
                        {name(e.title, locale) ? (
                          <dd className="mt-1 font-semibold">{name(e.title, locale)}</dd>
                        ) : null}
                        <dd className="mt-1 text-sm whitespace-pre-line">{name(e.text, locale)}</dd>
                      </div>
                    );
                  })}
                </dl>
              ) : null}
            </section>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">
        <Link href="/air/index" className="font-semibold text-brand hover:underline">
          {t("aboutIndex")} →
        </Link>
      </p>
    </div>
  );
}
