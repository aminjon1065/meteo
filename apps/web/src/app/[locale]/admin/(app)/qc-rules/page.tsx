import { asc } from "@meteo/db";
import { qcRules } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { QcRulesEditor } from "@/components/admin/qc/qc-rules-editor";
import { getDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session";
import { listPollutants } from "../scales/_data";
import { saveQcRules } from "./actions";

export const dynamic = "force-dynamic";

const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

/** Правила автоматического контроля качества (FR7.4): диапазоны веществ и пакетные проверки. */
export default async function QcRulesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdminSession(locale, "qcRules.write");
  const [t, pollutants, rules] = await Promise.all([
    getTranslations("qcRules"),
    listPollutants(),
    getDb().select().from(qcRules).orderBy(asc(qcRules.id)),
  ]);
  const general = (kind: "spike" | "stuck" | "mad_outlier") =>
    rules.find((r) => r.kind === kind && r.pollutantId === null);
  const spike = general("spike");
  const stuck = general("stuck");
  const outlier = general("mad_outlier");
  async function action(raw: unknown) {
    "use server";
    return saveQcRules(locale, raw);
  }
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <QcRulesEditor
        pollutants={pollutants.map((p) => ({
          id: p.id,
          shortName: p.shortName,
          unit: p.unit,
        }))}
        ranges={rules
          .filter((r) => r.kind === "range" && r.pollutantId !== null)
          .map((r) => ({
            pollutantId: r.pollutantId as number,
            min: num(r.params.min, 0),
            max: num(r.params.max, 0),
            enabled: r.enabled,
          }))}
        spike={{
          enabled: spike?.enabled ?? false,
          madMultiplier: num(spike?.params.madMultiplier, 6),
          minSamples: num(spike?.params.minSamples, 6),
        }}
        stuck={{
          enabled: stuck?.enabled ?? false,
          hours: num(stuck?.params.hours, 12),
          minRun: num(stuck?.params.minRun, 3),
        }}
        outlier={{
          enabled: outlier?.enabled ?? false,
          z: num(outlier?.params.z, 5),
          minBaseline: num(outlier?.params.minBaseline, 30),
        }}
        action={action}
      />
    </>
  );
}
