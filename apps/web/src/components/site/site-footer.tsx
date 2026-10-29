import type { Locale } from "@meteo/i18n";
import { pick } from "@meteo/i18n";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getBrandingCached } from "@/lib/settings";
import { FmiLogo } from "./fmi-logo";
import { Logo } from "./logo";

export async function SiteFooter() {
  const [t, tc, tn, locale, branding] = await Promise.all([
    getTranslations("footer"),
    getTranslations("common"),
    getTranslations("nav"),
    getLocale() as Promise<Locale>,
    getBrandingCached(),
  ]);
  const year = new Date().getFullYear();
  const agency = pick(branding.agencyName, locale) || tc("agency");
  const note = pick(branding.footerNote, locale);
  const address = pick(branding.address, locale);
  const hasContacts = Boolean(branding.email || branding.phone || address || branding.website);
  const sections = [
    { href: "/air/silam", label: tn("silam") },
    { href: "/air/index", label: t("aboutIndex") },
    { href: "/health", label: tn("health") },
    { href: "/air/bulletins", label: t("ecoBulletins") },
    { href: "/data", label: tn("data") },
    { href: "/data/api", label: t("api") },
    { href: "/subscribe", label: t("subscribe") },
    { href: "/about", label: tn("about") },
  ];

  return (
    <footer className="mt-10 border-t bg-card">
      <div className="container-page grid gap-8 py-8 pb-10 text-sm text-muted-foreground md:grid-cols-[2fr_1fr_1fr] md:gap-6">
        <div className="max-w-md space-y-2">
          <div className="flex items-center gap-3">
            <Logo className="size-14" />
            <p className="font-semibold text-foreground">{agency}</p>
          </div>
          {/* Партнёр проекта — под Агентством и мельче его эмблемы; поле вокруг логотипа ≥ 1/4 знака. */}
          <div className="space-y-3 py-1.5">
            <p>{t("supportedBy")}</p>
            <FmiLogo alt={tc("fmiName")} onWhite />
          </div>
          {note ? <p>{note}</p> : null}
          <p>{t("dataLicense")}</p>
        </div>
        <nav className="flex flex-col gap-1.5" aria-label={t("sections")}>
          <p className="mb-0.5 font-semibold text-foreground">{t("sections")}</p>
          {sections.map((s) => (
            <Link key={s.href} href={s.href} className="w-fit hover:text-foreground">
              {s.label}
            </Link>
          ))}
        </nav>
        <div className="space-y-2">
          <p className="font-semibold text-foreground">{t("contacts")}</p>
          {hasContacts ? (
            <address className="space-y-1 not-italic">
              {address ? <p>{address}</p> : null}
              {branding.phone ? (
                <p>
                  <a
                    href={`tel:${branding.phone.replace(/[^+\d]/g, "")}`}
                    className="hover:text-foreground"
                  >
                    {branding.phone}
                  </a>
                </p>
              ) : null}
              {branding.email ? (
                <p>
                  <a href={`mailto:${branding.email}`} className="hover:text-foreground">
                    {branding.email}
                  </a>
                </p>
              ) : null}
              {branding.website ? (
                <p>
                  <a href={branding.website} className="hover:text-foreground" rel="noopener">
                    {branding.website.replace(/^https?:\/\//, "")}
                  </a>
                </p>
              ) : null}
            </address>
          ) : (
            <p>{t("contactsSoon")}</p>
          )}
          <p className="pt-2">{t("rights", { year })}</p>
          <p>
            <Link href="/admin" className="hover:text-foreground">
              {tn("admin")}
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}
