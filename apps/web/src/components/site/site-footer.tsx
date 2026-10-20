import type { Locale } from "@meteo/i18n";
import { pick } from "@meteo/i18n";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getBrandingCached } from "@/lib/settings";

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

  return (
    <footer className="border-t bg-card">
      <div className="container-page grid gap-8 py-10 text-sm text-muted-foreground md:grid-cols-[2fr_1fr_1fr]">
        <div className="max-w-md space-y-2">
          <p className="font-medium text-foreground">{agency}</p>
          <p>{tc("fintaj")}</p>
          {note ? <p>{note}</p> : null}
        </div>
        <nav className="flex flex-col gap-2" aria-label={t("sections")}>
          <Link href="/about" className="hover:text-foreground">
            {tn("about")}
          </Link>
          <Link href="/air/index" className="hover:text-foreground">
            {t("aboutIndex")}
          </Link>
          <Link href="/air/bulletins" className="hover:text-foreground">
            {t("ecoBulletins")}
          </Link>
          <Link href="/data" className="hover:text-foreground">
            {tn("data")}
          </Link>
          <Link href="/data/api" className="hover:text-foreground">
            {t("api")}
          </Link>
          <Link href="/subscribe" className="hover:text-foreground">
            {t("subscribe")}
          </Link>
          <Link href="/admin" className="hover:text-foreground">
            {tn("admin")}
          </Link>
        </nav>
        <div className="space-y-2 md:text-right">
          {hasContacts ? (
            <address className="space-y-1 not-italic">
              {branding.email ? (
                <p>
                  <a href={`mailto:${branding.email}`} className="hover:text-foreground">
                    {branding.email}
                  </a>
                </p>
              ) : null}
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
              {address ? <p>{address}</p> : null}
              {branding.website ? (
                <p>
                  <a href={branding.website} className="hover:text-foreground" rel="noopener">
                    {branding.website.replace(/^https?:\/\//, "")}
                  </a>
                </p>
              ) : null}
            </address>
          ) : null}
          <p>{t("rights", { year })}</p>
          <p>{t("dataLicense")}</p>
        </div>
      </div>
    </footer>
  );
}
