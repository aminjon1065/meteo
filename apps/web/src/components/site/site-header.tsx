import type { Locale } from "@meteo/i18n";
import { pick } from "@meteo/i18n";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { resolveCity } from "@/lib/city";
import { getBrandingCached } from "@/lib/settings";
import { CitySelect } from "./city-select";
import { LanguageSwitcher } from "./language-switcher";
import { Logo } from "./logo";
import { MainNav, type NavItem } from "./main-nav";
import { MobileNav } from "./mobile-nav";
import { ThemeToggle } from "./theme-toggle";

/** Шесть разделов верхней навигации (docs/03 §3). */
export async function getNavItems(): Promise<NavItem[]> {
  const t = await getTranslations("nav");
  return [
    { href: "/", label: t("home") },
    { href: "/air", label: t("airShort") },
    { href: "/weather", label: t("weather") },
    { href: "/map", label: t("map") },
    { href: "/warnings", label: t("warnings") },
    { href: "/news", label: t("news") },
  ];
}

/** Остальные разделы — для листа «Ещё» на телефоне. */
export async function getMoreNavItems(): Promise<NavItem[]> {
  const [t, tf] = await Promise.all([getTranslations("nav"), getTranslations("footer")]);
  return [
    { href: "/warnings", label: t("warnings") },
    { href: "/news", label: t("news") },
    { href: "/health", label: t("health") },
    { href: "/air/index", label: tf("aboutIndex") },
    { href: "/air/bulletins", label: tf("ecoBulletins") },
    { href: "/data", label: t("data") },
    { href: "/subscribe", label: tf("subscribe") },
    { href: "/about", label: t("about") },
  ];
}

export async function SiteHeader() {
  const [tc, items, more, locale, branding, cityState] = await Promise.all([
    getTranslations("common"),
    getNavItems(),
    getMoreNavItems(),
    getLocale() as Promise<Locale>,
    getBrandingCached(),
    resolveCity(),
  ]);
  const siteName = pick(branding.siteName, locale) || tc("siteName");

  return (
    <>
      <header className="sticky top-0 z-40 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/85">
        <a
          href="#content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
        >
          {tc("skipToContent")}
        </a>
        <div className="container-page flex h-16 items-center gap-3 lg:gap-6">
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
              cities={cityState.cities.map((c) => ({ slug: c.slug, name: c.name }))}
              selected={cityState.city?.slug ?? null}
            />
          ) : null}
          <MainNav items={items} className="ml-auto hidden lg:flex" />
          <div className="ml-auto flex items-center gap-1 lg:ml-0">
            <LanguageSwitcher variant="inline" />
            {/* До 380 px переключатель темы остаётся в листе «Ещё» нижней навигации */}
            <span className="hidden min-[380px]:inline-flex">
              <ThemeToggle />
            </span>
          </div>
        </div>
      </header>
      <MobileNav primary={items.slice(0, 4)} more={more} />
    </>
  );
}
