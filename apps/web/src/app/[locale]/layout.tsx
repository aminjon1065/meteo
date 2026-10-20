import type { Locale } from "@meteo/i18n";
import { localeTags } from "@meteo/i18n";
import "@meteo/ui/globals.css";
import { Toaster } from "@meteo/ui/components/sonner";
import { TooltipProvider } from "@meteo/ui/components/tooltip";
import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight } from "next/font/google";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ThemeProvider } from "@/components/theme-provider";
import { routing } from "@/i18n/routing";

/*
 * Inter — текст, Inter Tight — заголовки и крупные числа (docs/03-design-system.md §5).
 * Подмножества cyrillic + cyrillic-ext обязательны: таджикские буквы ғ ӣ қ ӯ ҳ ҷ лежат в
 * расширенной кириллице (U+0490–U+04FF), без неё они выпадали бы в системный шрифт.
 * latin-ext не нужен (tg/ru/en), а Inter Tight не предзагружается: на медленной сети
 * текст (LCP) получает Inter первым, заголовки дорисовываются по мере загрузки.
 */
const inter = Inter({
  subsets: ["latin", "cyrillic", "cyrillic-ext"],
  variable: "--font-inter",
  display: "swap",
});
const interTight = Inter_Tight({
  subsets: ["latin", "cyrillic", "cyrillic-ext"],
  variable: "--font-inter-tight",
  display: "swap",
  preload: false,
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f5f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1724" },
  ],
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "common" });
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
    title: { default: t("siteName"), template: `%s · ${t("siteName")}` },
    description: t("siteTagline"),
    applicationName: t("siteName"),
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  // Nonce CSP из proxy.ts: инлайн-скрипт next-themes (класс темы до гидрации) должен его нести.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang={localeTags[locale as Locale]}
      suppressHydrationWarning
      className={`${inter.variable} ${interTight.variable} font-sans`}
    >
      <body className="min-h-dvh">
        <ThemeProvider nonce={nonce}>
          <NextIntlClientProvider>
            <TooltipProvider>{children}</TooltipProvider>
            <Toaster richColors position="top-right" />
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
