import { asc, eq } from "@meteo/db";
import { healthAdvice, indexScales } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { HealthAdviceEditor } from "@/components/admin/health/health-advice-editor";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { requireAdminSession } from "@/lib/session";
import { saveHealthAdvice } from "../scales/actions";

export const dynamic = "force-dynamic";

export default async function HealthAdvicePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ scale?: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdminSession(locale, "healthAdvice.write");
  const sp = await searchParams;
  const db = getDb();
  const [t, scales] = await Promise.all([
    getTranslations("healthAdmin"),
    db
      .select()
      .from(indexScales)
      .where(eq(indexScales.enabled, true))
      .orderBy(asc(indexScales.sortOrder)),
  ]);
  const scale =
    scales.find((s) => String(s.id) === sp.scale) ??
    scales.find((s) => s.isDefaultPublic) ??
    scales[0];
  if (!scale) return <p className="text-muted-foreground">{t("noScales")}</p>;
  const entries = await db.select().from(healthAdvice).where(eq(healthAdvice.scaleId, scale.id));
  async function action(raw: unknown) {
    "use server";
    return saveHealthAdvice(locale, raw);
  }
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">
          {t("subtitle")} · {name(scale.name, locale) || scale.code}
        </p>
      </div>
      <HealthAdviceEditor
        scaleId={scale.id}
        scales={scales.map((s) => ({ id: s.id, name: name(s.name, locale) || s.code }))}
        levels={scale.levels.map((l) => ({
          level: l.level,
          color: l.color,
          label: name(l.label, locale),
        }))}
        entries={entries.map((e) => ({
          level: e.level,
          audience: e.audience,
          title: e.title,
          text: e.text,
        }))}
        action={action}
      />
    </>
  );
}
