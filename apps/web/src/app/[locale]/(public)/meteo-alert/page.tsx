import type { Locale } from "@meteo/i18n";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { pageMetadata } from "@/lib/seo";
import { AGENCY_ALERT_SITE } from "@/lib/warnings";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = (await params) as { locale: Locale };
  const t = await getTranslations({ locale, namespace: "warnings" });
  return pageMetadata({
    locale,
    path: "/meteo-alert",
    title: t("agencyMapTitle"),
    description: t("agencyMapIntro"),
  });
}

/**
 * Meteo Alert: карта SmartMet Alert Агентства (alert.meteo.tj) внутри портала, под шапкой портала
 * (меню, город, язык, тема), на весь экран и без подвала - как карта на главной. Встраивание
 * разрешает frame-src в CSP (lib/security/csp.ts); язык карты выбирают в ней самой.
 */
export default async function MeteoAlertPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("warnings");
  return (
    <>
      <h1 className="sr-only">{t("agencyMapTitle")}</h1>
      <iframe
        src={AGENCY_ALERT_SITE}
        title={t("agencyMapFrame")}
        className="block h-[calc(100dvh-4rem-1px)] w-full border-0"
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer"
        data-testid="meteo-alert-frame"
      />
    </>
  );
}
