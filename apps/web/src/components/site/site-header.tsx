import type { Locale } from "@meteo/i18n";
import { pick } from "@meteo/i18n";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { resolveCity } from "@/lib/city";
import { getBrandingCached } from "@/lib/settings";
import { CitySelect } from "./city-select";
import { FmiLogo } from "./fmi-logo";
import { LanguageSwitcher } from "./language-switcher";
import { Logo } from "./logo";
import { type NavItem, SiteMenu } from "./site-menu";
import { ThemeToggle } from "./theme-toggle";

/**
 * Разделы меню ☰ (по образцу data.meteo.uz, просьба Заказчика 31.10.2026): системы SmartMet —
 * отдельными пунктами, «Карта» — главная страница.
 */
export async function getMenuItems(): Promise<NavItem[]> {
  const t = await getTranslations("nav");
  return [
    { href: "/warnings", label: t("meteoAlert") },
    { href: "/weather", label: t("forecast") },
    { href: "/air/silam", label: t("silam") },
    { href: "/air", label: t("airMonitoring") },
    { href: "/", label: t("map") },
    { href: "/news", label: t("news") },
    { href: "/health", label: t("health") },
    { href: "/data", label: t("dataApi") },
    { href: "/about", label: t("about") },
  ];
}

/** Справочные разделы — под чертой в том же меню. */
export async function getMoreMenuItems(): Promise<NavItem[]> {
  const tf = await getTranslations("footer");
  return [
    { href: "/air/index", label: tf("aboutIndex") },
    { href: "/air/bulletins", label: tf("ecoBulletins") },
    { href: "/subscribe", label: tf("subscribe") },
  ];
}

export async function SiteHeader() {
  const [tc, tf, items, more, locale, branding, cityState] = await Promise.all([
    getTranslations("common"),
    getTranslations("footer"),
    getMenuItems(),
    getMoreMenuItems(),
    getLocale() as Promise<Locale>,
    getBrandingCached(),
    resolveCity(),
  ]);
  const siteName = pick(branding.siteName, locale) || tc("siteName");

  return (
    <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        {tc("skipToContent")}
      </a>
      {/* Во всю ширину, а не по контейнеру: на главной под шапкой карта от края до края. */}
      <div className="flex h-16 w-full items-center gap-2 pr-[max(1rem,env(safe-area-inset-right,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))] sm:gap-3 lg:gap-4">
        <SiteMenu
          items={items}
          more={more}
          credit={
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>{tf("supportedBy")}</p>
              <FmiLogo alt={tc("fmiName")} onWhite />
            </div>
          }
        />
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2.5 font-heading text-[1.05rem] font-bold"
          aria-label={siteName}
        >
          <Logo className="size-[30px]" />
          <span className="hidden sm:inline">{siteName}</span>
        </Link>
        {cityState.cities.length > 0 ? (
          <CitySelect
            cities={cityState.cities.map((c) => ({
              slug: c.slug,
              name: c.name,
              region: c.regionCode,
            }))}
            selected={cityState.city?.slug ?? null}
          />
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <LanguageSwitcher variant="inline" />
          {/* На телефоне тема — в меню ☰, чтобы шапка помещалась в 360 px. */}
          <span className="hidden sm:inline-flex">
            <ThemeToggle />
          </span>
        </div>
      </div>
    </header>
  );
}
