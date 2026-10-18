import type { Locale } from "@meteo/i18n";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { StationForm } from "@/components/admin/stations/station-form";
import { requireAdminSession } from "@/lib/session";
import type { StationInput } from "@/lib/validation/station";
import { loadStationFormOptions } from "../_data";
import { createStation } from "../actions";

export const dynamic = "force-dynamic";

export default async function NewStationPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdminSession(locale, "stations.write");
  const [t, options] = await Promise.all([getTranslations("stations"), loadStationFormOptions()]);

  async function action(raw: StationInput) {
    "use server";
    return createStation(locale, raw);
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("add")}</h1>
        <p className="text-muted-foreground">{t("hints.new")}</p>
      </div>
      <StationForm options={options} action={action} />
    </>
  );
}
