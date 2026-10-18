import type { Locale } from "@meteo/i18n";
import { pick } from "@meteo/i18n";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { CloudSunIcon, InfoIcon, RadioIcon, SirenIcon, WindIcon } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getBrandingCached } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "about" });
  return { title: t("title"), description: t("intro") };
}

const SOURCES = [
  { key: "stations", icon: RadioIcon, href: "/air" },
  { key: "smartmet", icon: CloudSunIcon, href: "/weather" },
  { key: "silam", icon: WindIcon, href: "/map" },
  { key: "cap", icon: SirenIcon, href: "/warnings" },
] as const;

/** О портале: назначение, организация, проект FINTAJ/FMI, источники данных, контакты. */
export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const [t, tc, branding] = await Promise.all([
    getTranslations("about"),
    getTranslations("common"),
    getBrandingCached(),
  ]);
  const agency = pick(branding.agencyName, locale) || tc("agency");
  const contacts = [
    branding.email
      ? { label: t("contacts.email"), value: branding.email, href: `mailto:${branding.email}` }
      : null,
    branding.phone
      ? {
          label: t("contacts.phone"),
          value: branding.phone,
          href: `tel:${branding.phone.replace(/[^+\d]/g, "")}`,
        }
      : null,
    pick(branding.address, locale)
      ? { label: t("contacts.address"), value: pick(branding.address, locale), href: null }
      : null,
    branding.website
      ? {
          label: t("contacts.website"),
          value: branding.website.replace(/^https?:\/\//, ""),
          href: branding.website,
        }
      : null,
  ].filter((c): c is { label: string; value: string; href: string | null } => c !== null);

  return (
    <div className="container-page flex flex-col gap-10 py-10">
      <div className="flex flex-col gap-3">
        <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
          <InfoIcon className="size-8 text-brand" aria-hidden="true" />
          {t("title")}
        </h1>
        <p className="max-w-3xl text-lg text-muted-foreground">{t("intro")}</p>
      </div>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-6">
          <h2 className="text-xl font-semibold">{t("agency.title")}</h2>
          <p className="font-medium">{agency}</p>
          <p className="text-sm text-muted-foreground">{t("agency.text")}</p>
        </div>
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-6">
          <h2 className="text-xl font-semibold">{t("project.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("project.text")}</p>
          <p className="text-sm text-muted-foreground">{t("project.fmi")}</p>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">{t("sources.title")}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("sources.intro")}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SOURCES.map((s) => {
            const Icon = s.icon;
            return (
              <Card key={s.key}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Icon className="size-4 text-brand" aria-hidden="true" />
                    {t(`sources.${s.key}.title`)}
                  </CardTitle>
                  <CardDescription>{t(`sources.${s.key}.text`)}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Link
                    href={s.href}
                    className="text-sm text-brand underline-offset-4 hover:underline"
                  >
                    {t("sources.open")}
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border bg-card p-6 text-sm">
          <h2 className="mb-2 text-base font-semibold">{t("openData.title")}</h2>
          <p className="text-muted-foreground">{t("openData.text")}</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Link href="/data" className="text-brand underline-offset-4 hover:underline">
              {t("openData.data")}
            </Link>
            <Link href="/data/api" className="text-brand underline-offset-4 hover:underline">
              {t("openData.api")}
            </Link>
            <Link href="/air/index" className="text-brand underline-offset-4 hover:underline">
              {t("openData.index")}
            </Link>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-6 text-sm">
          <h2 className="mb-2 text-base font-semibold">{t("languages.title")}</h2>
          <p className="text-muted-foreground">{t("languages.text")}</p>
          <p className="mt-2 text-muted-foreground">{t("accessibility")}</p>
        </div>
        <div className="rounded-xl border bg-card p-6 text-sm">
          <h2 className="mb-2 text-base font-semibold">{t("contacts.title")}</h2>
          {contacts.length === 0 ? (
            <p className="text-muted-foreground">{t("contacts.none")}</p>
          ) : (
            <dl className="grid gap-2">
              {contacts.map((c) => (
                <div key={c.label} className="flex flex-col">
                  <dt className="text-xs text-muted-foreground">{c.label}</dt>
                  <dd>
                    {c.href ? (
                      <a href={c.href} className="text-brand underline-offset-4 hover:underline">
                        {c.value}
                      </a>
                    ) : (
                      c.value
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </section>

      <p className="text-sm text-muted-foreground">{t("disclaimer")}</p>
    </div>
  );
}
