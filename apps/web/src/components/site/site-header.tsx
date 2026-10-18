import type { Locale } from "@meteo/i18n";
import { pick } from "@meteo/i18n";
import { getLocale, getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getBrandingCached } from "@/lib/settings";
import { LanguageSwitcher } from "./language-switcher";
import { Logo } from "./logo";
import { MainNav, type NavItem } from "./main-nav";
import { MobileNav } from "./mobile-nav";
import { ThemeToggle } from "./theme-toggle";

export async function getNavItems(): Promise<NavItem[]> {
  const t = await getTranslations("nav");
  return [
    { href: "/", label: t("home") },
    { href: "/air", label: t("air") },
    { href: "/map", label: t("map") },
    { href: "/weather", label: t("weather") },
    { href: "/warnings", label: t("warnings") },
    { href: "/health", label: t("health") },
    { href: "/news", label: t("news") },
  ];
}

export async function SiteHeader() {
  const [tc, items, locale, branding] = await Promise.all([
    getTranslations("common"),
    getNavItems(),
    getLocale() as Promise<Locale>,
    getBrandingCached(),
  ]);
  const siteName = pick(branding.siteName, locale) || tc("siteName");

  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
      >
        {tc("skipToContent")}
      </a>
      <div className="container-page flex h-16 items-center gap-4">
        <Link href="/" className="flex items-center gap-2.5 font-semibold" aria-label={siteName}>
          <Logo />
          <span className="hidden flex-col leading-tight sm:flex">
            <span>{siteName}</span>
            <span className="text-xs font-normal text-muted-foreground">{tc("siteTagline")}</span>
          </span>
        </Link>
        <MainNav items={items} className="ml-4 hidden lg:flex" />
        <div className="ml-auto flex items-center gap-1">
          <LanguageSwitcher />
          <ThemeToggle />
          <MobileNav items={items} />
        </div>
      </div>
    </header>
  );
}
