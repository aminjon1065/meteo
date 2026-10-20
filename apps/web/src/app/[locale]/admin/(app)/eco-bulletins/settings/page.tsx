import { getEcoBulletinSettings } from "@meteo/db";
import type { Locale } from "@meteo/i18n";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { ArrowLeftIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EcoBulletinSettingsForm } from "@/components/admin/eco-bulletins/settings-form";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session";
import { loadStationOptions } from "../_data";
import { saveEcoBulletinSettings } from "../actions";

export const dynamic = "force-dynamic";

export default async function EcoBulletinSettingsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdminSession(locale, "ecoBulletin.write");
  const [t, settings, stations] = await Promise.all([
    getTranslations("ecoBulletin"),
    getEcoBulletinSettings(getDb()),
    loadStationOptions(),
  ]);

  async function action(raw: unknown) {
    "use server";
    return saveEcoBulletinSettings(locale, raw);
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Link
          href="/admin/eco-bulletins"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          {t("title")}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{t("settings.title")}</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.title")}</CardTitle>
          <CardDescription>{t("settings.hint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <EcoBulletinSettingsForm initial={settings} stations={stations} action={action} />
        </CardContent>
      </Card>
    </>
  );
}
