import type { Locale } from "@meteo/i18n";
import { pick } from "@meteo/i18n";
import { CloudSunIcon, RadioIcon, SirenIcon, WindIcon } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageHeader, Section } from "@/components/site/page-header";
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
    <div className="container-page flex flex-col gap-10 py-8">
      <PageHeader title={t("title")} intro={t("intro")} />

      <div className="grid gap-8 md:grid-cols-2">
        <section>
          <h2 className="text-h2">{t("agency.title")}</h2>
          <p className="mt-2 font-semibold">{agency}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("agency.text")}</p>
        </section>
        <section>
          <h2 className="text-h2">{t("project.title")}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t("project.text")}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t("project.fmi")}</p>
        </section>
      </div>

      <Section title={t("sources.title")} id="sources">
        <p className="mb-4 max-w-3xl text-sm text-muted-foreground">{t("sources.intro")}</p>
        <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {SOURCES.map((s) => {
            const Icon = s.icon;
            return (
              <li
                key={s.key}
                className="grid content-start gap-1.5 rounded-xl border bg-card px-4 py-3.5"
              >
                <Icon className="size-5 text-brand" aria-hidden="true" />
                <h3 className="text-h3">{t(`sources.${s.key}.title`)}</h3>
                <p className="text-sm text-muted-foreground">{t(`sources.${s.key}.text`)}</p>
                <Link href={s.href} className="text-sm font-semibold text-brand hover:underline">
                  {t("sources.open")} →
                </Link>
              </li>
            );
          })}
        </ul>
      </Section>

      <div className="grid gap-8 text-sm lg:grid-cols-3">
        <section>
          <h2 className="mb-2 text-h3">{t("openData.title")}</h2>
          <p className="text-muted-foreground">{t("openData.text")}</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            <Link href="/data" className="font-semibold text-brand hover:underline">
              {t("openData.data")}
            </Link>
            <Link href="/data/api" className="font-semibold text-brand hover:underline">
              {t("openData.api")}
            </Link>
            <Link href="/air/index" className="font-semibold text-brand hover:underline">
              {t("openData.index")}
            </Link>
          </div>
        </section>
        <section>
          <h2 className="mb-2 text-h3">{t("languages.title")}</h2>
          <p className="text-muted-foreground">{t("languages.text")}</p>
          <p className="mt-2 text-muted-foreground">{t("accessibility")}</p>
        </section>
        <section>
          <h2 className="mb-2 text-h3">{t("contacts.title")}</h2>
          {contacts.length === 0 ? (
            <p className="text-muted-foreground">{t("contacts.none")}</p>
          ) : (
            <dl className="grid gap-2">
              {contacts.map((c) => (
                <div key={c.label} className="flex flex-col">
                  <dt className="text-caption text-muted-foreground">{c.label}</dt>
                  <dd>
                    {c.href ? (
                      <a href={c.href} className="font-medium text-brand hover:underline">
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
        </section>
      </div>

      <p className="text-sm text-muted-foreground">{t("disclaimer")}</p>
    </div>
  );
}
