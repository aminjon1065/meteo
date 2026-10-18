import { asc, eq } from "@meteo/db";
import { healthAdvice, indexScales } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { AqBadge } from "@meteo/ui/components/aq-badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";

export const dynamic = "force-dynamic";
const AUDIENCES = ["general", "children", "pregnant", "elderly", "respiratory", "cardio"] as const;
const LEVEL_BORDER: Record<number, string> = {
  1: "border-aq-1/50",
  2: "border-aq-2/50",
  3: "border-aq-3/50",
  4: "border-aq-4/50",
  5: "border-aq-5/50",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "health" });
  return { title: t("title"), description: t("intro") };
}

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
    <div className="container-page flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="max-w-3xl text-muted-foreground">{t("intro")}</p>
        <p className="text-sm text-muted-foreground">{t("disclaimer")}</p>
      </div>
      <div className="flex flex-col gap-6">
        {levels.map((lv) => {
          const forLevel = entries.filter((e) => e.level === lv.level);
          const level = Math.min(5, Math.max(1, lv.level)) as 1 | 2 | 3 | 4 | 5;
          return (
            <Card key={lv.level} className={LEVEL_BORDER[level]}>
              <CardHeader>
                <CardTitle className="flex items-center gap-3 text-lg">
                  <AqBadge
                    level={level}
                    label={name(lv.label, locale) || tl(`${level}` as "1")}
                    size="lg"
                  />
                </CardTitle>
                {forLevel.length === 0 ? <CardDescription>{t("noAdvice")}</CardDescription> : null}
              </CardHeader>
              {forLevel.length > 0 ? (
                <CardContent className="grid gap-4 md:grid-cols-2">
                  {AUDIENCES.filter((a) => forLevel.some((e) => e.audience === a)).map((a) => {
                    const e = forLevel.find((x) => x.audience === a);
                    if (!e) return null;
                    return (
                      <div key={a} className="rounded-lg border p-4">
                        <p className="text-xs font-medium text-muted-foreground uppercase">
                          {t(`audience.${a}`)}
                        </p>
                        {name(e.title, locale) ? (
                          <p className="mt-1 font-semibold">{name(e.title, locale)}</p>
                        ) : null}
                        <p className="mt-1 text-sm whitespace-pre-line">{name(e.text, locale)}</p>
                      </div>
                    );
                  })}
                </CardContent>
              ) : null}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
