/**
 * Метаданные страниц для поисковиков и соцсетей (FR6.7): canonical, hreflang, Open Graph, Twitter.
 *
 * Next.js сливает metadata сегментов поверхностно: если страница задаёт `openGraph`, значения
 * лейаута (siteName, картинка) пропадают. Поэтому страницы собирают весь набор через
 * pageMetadata(), а лейаут задаёт только запасной вариант для страниц без своего.
 */
import { type Locale, locales } from "@meteo/i18n";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/**
 * hreflang — коды языков без письменности и страны, как в заголовке Link от next-intl: один и тот
 * же вид в заголовке, в <link rel="alternate"> и в sitemap.xml (часть валидаторов не принимает
 * «tg-Cyrl-TJ»). Атрибут <html lang> остаётся полным тегом (localeTags).
 */
export const hreflang: Record<Locale, string> = { tg: "tg", ru: "ru", en: "en" };

/** og:locale — формат язык_СТРАНА. */
export const ogLocale: Record<Locale, string> = { tg: "tg_TJ", ru: "ru_RU", en: "en_US" };

/** Картинка по умолчанию (scripts/og-image.mjs): эмблема, название и силуэт страны. */
export const DEFAULT_OG_IMAGE = { url: "/og/default.jpg", width: 1200, height: 630 } as const;

/** Эмблема Агентства в PNG для publisher.logo в JSON-LD (тот же скрипт). */
export const LOGO_URL = "/og/logo.png";

/** Адрес сайта без «/» в конце; у staging и production он разный, образ один — читается в рантайме. */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

/** Путь на языке: tg — без префикса, остальные — /ru/…, /en/… */
export function localizedPath(locale: Locale, path: string): string {
  const prefix = locale === "tg" ? "" : `/${locale}`;
  if (path === "/") return prefix || "/";
  return `${prefix}${path}`;
}

export function absoluteUrl(locale: Locale, path: string): string {
  return `${siteUrl()}${localizedPath(locale, path)}`;
}

/** hreflang‑альтернативы страницы на трёх языках + x-default (государственный язык). */
export function languageAlternates(path: string): Record<string, string> {
  return {
    ...Object.fromEntries(locales.map((l) => [hreflang[l], absoluteUrl(l, path)])),
    "x-default": absoluteUrl("tg", path),
  };
}

export interface OgImage {
  url: string;
  width?: number;
  height?: number;
  alt?: string;
}

export interface PageSeo {
  locale: Locale;
  /** Путь без префикса языка: "/", "/air/stations/dushanbe". */
  path: string;
  /** Заголовок страницы (в <title> добавится «· Метеопортал»); без него — название сайта. */
  title?: string;
  description?: string;
  type?: "website" | "article";
  images?: OgImage[];
  publishedTime?: string;
  modifiedTime?: string;
  /** Служебные страницы (подтверждение подписки и т. п.): не индексировать. */
  noindex?: boolean;
}

/** Полный набор метаданных страницы: заголовок, canonical, hreflang, Open Graph и Twitter. */
export async function pageMetadata(p: PageSeo): Promise<Metadata> {
  const t = await getTranslations({ locale: p.locale, namespace: "common" });
  const siteName = t("siteName");
  const title = p.title ?? siteName;
  const description = p.description ?? t("siteTagline");
  const url = absoluteUrl(p.locale, p.path);
  const images = p.images?.length ? p.images : [{ ...DEFAULT_OG_IMAGE, alt: siteName }];
  return {
    ...(p.title ? { title: p.title } : {}),
    description,
    alternates: { canonical: url, languages: languageAlternates(p.path) },
    openGraph: {
      type: p.type ?? "website",
      siteName,
      title,
      description,
      url,
      locale: ogLocale[p.locale],
      alternateLocale: locales.filter((l) => l !== p.locale).map((l) => ogLocale[l]),
      images,
      ...(p.type === "article"
        ? { publishedTime: p.publishedTime, modifiedTime: p.modifiedTime }
        : {}),
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: images.map((i) => i.url),
    },
    ...(p.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}
