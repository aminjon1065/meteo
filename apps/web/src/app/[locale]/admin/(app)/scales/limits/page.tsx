import { limitValues } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LimitsEditor } from "@/components/admin/scales/limits-editor";
import { getDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session";
import { listPollutants } from "../_data";
import { saveLimits } from "../actions";

export const dynamic = "force-dynamic";

export default async function LimitsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdminSession(locale, "scales.write");
  const [t, pollutants, limits] = await Promise.all([
    getTranslations("scales"),
    listPollutants(),
    getDb().select().from(limitValues),
  ]);
  async function action(raw: unknown) {
    "use server";
    return saveLimits(locale, raw);
  }
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("limits.title")}</h1>
        <p className="text-muted-foreground">{t("limits.subtitle")}</p>
      </div>
      <LimitsEditor
        pollutants={pollutants}
        limits={limits.map((l) => ({ pollutantId: l.pollutantId, kind: l.kind, value: l.value }))}
        action={action}
      />
    </>
  );
}
