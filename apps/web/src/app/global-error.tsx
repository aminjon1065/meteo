"use client";

import "@meteo/ui/globals.css";
import { criticalErrorText, defaultLocale, isLocale, localeTags } from "@meteo/i18n";
import { usePathname } from "next/navigation";

/**
 * Аварийная страница: корневой лейаут ([locale]/layout.tsx) сам упал. Своё <html>, стили
 * подключены здесь; язык — по первому сегменту адреса (tg — без префикса).
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const first = usePathname()?.split("/")[1];
  const locale = isLocale(first) ? first : defaultLocale;
  const t = criticalErrorText[locale];
  return (
    <html lang={localeTags[locale]}>
      <body className="min-h-dvh bg-background font-sans text-foreground">
        <title>{t.title}</title>
        <main
          role="alert"
          className="container-page flex min-h-dvh flex-col items-center justify-center gap-4 py-24 text-center"
        >
          <h1 className="text-h2">{t.title}</h1>
          <p className="max-w-md text-muted-foreground">{t.description}</p>
          <button
            type="button"
            onClick={() => retry()}
            className="rounded-lg bg-primary px-4 py-2 font-medium text-primary-foreground"
          >
            {t.retry}
          </button>
          {error.digest ? <p className="text-xs text-muted-foreground">{error.digest}</p> : null}
        </main>
      </body>
    </html>
  );
}
