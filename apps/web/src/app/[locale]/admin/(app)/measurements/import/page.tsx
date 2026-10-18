import type { Locale } from "@meteo/i18n";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ImportWizard } from "@/components/admin/measurements/import-wizard";
import { requireAdminSession } from "@/lib/session";
import { loadEntryStations } from "../_data";
import { applyImport, previewImport, rejectImport } from "../actions";

export const dynamic = "force-dynamic";

export default async function ImportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdminSession(locale, "measurements.write");
  const [t, stations] = await Promise.all([getTranslations("measurements"), loadEntryStations()]);

  async function preview(formData: FormData) {
    "use server";
    return previewImport(locale, formData);
  }
  async function apply(batchId: string) {
    "use server";
    return applyImport(locale, batchId);
  }
  async function reject(batchId: string) {
    "use server";
    return rejectImport(locale, batchId);
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("cards.import.title")}</h1>
        <p className="text-muted-foreground">{t("cards.import.text")}</p>
      </div>
      <ImportWizard
        stations={stations.map((s) => ({ code: s.code, name: s.name }))}
        preview={preview}
        apply={apply}
        reject={reject}
      />
    </>
  );
}
