import type { Locale } from "@meteo/i18n";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ManualEntryForm } from "@/components/admin/measurements/manual-entry-form";
import { requireAdminSession } from "@/lib/session";
import { loadEntryStations } from "../_data";
import { saveManualMeasurements } from "../actions";

export const dynamic = "force-dynamic";

export default async function EntryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdminSession(locale, "measurements.write");
  const [t, stations] = await Promise.all([getTranslations("measurements"), loadEntryStations()]);

  async function action(raw: unknown) {
    "use server";
    return saveManualMeasurements(locale, raw);
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("cards.entry.title")}</h1>
        <p className="text-muted-foreground">{t("cards.entry.text")}</p>
      </div>
      <ManualEntryForm stations={stations} action={action} />
    </>
  );
}
