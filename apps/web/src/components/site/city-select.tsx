"use client";

import type { I18nText, Locale } from "@meteo/i18n";
import { pick } from "@meteo/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@meteo/ui/components/dropdown-menu";
import { cn } from "@meteo/ui/lib/utils";
import { CheckIcon, ChevronDownIcon, MapPinIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";
import { useRouter } from "@/i18n/navigation";

export interface CityChoice {
  slug: string;
  name: I18nText;
}

const COOKIE = "meteo-city";
const YEAR = 60 * 60 * 24 * 365;

/**
 * Выбор города в шапке: cookie (читают главная и /weather на сервере) + localStorage,
 * после выбора серверные компоненты перерисовываются через router.refresh().
 */
export function CitySelect({
  cities,
  selected,
  className,
}: {
  cities: CityChoice[];
  selected: string | null;
  className?: string;
}) {
  const t = useTranslations("common");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const current = cities.find((c) => c.slug === selected) ?? cities[0];
  if (!current) return null;

  const choose = (slug: string) => {
    // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API нет в Safari и Firefox; cookie читает сервер (lib/city.ts)
    document.cookie = `${COOKIE}=${encodeURIComponent(slug)}; path=/; max-age=${YEAR}; samesite=lax`;
    try {
      localStorage.setItem(COOKIE, slug);
    } catch {
      // приватный режим или запрет хранилища — достаточно cookie
    }
    startTransition(() => router.refresh());
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${pick(current.name, locale)} · ${t("city")}`}
        data-pending={pending || undefined}
        className={cn(
          "inline-flex h-9 max-w-[11rem] items-center gap-1.5 rounded-full border bg-card pr-2.5 pl-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted data-pending:opacity-70 sm:max-w-none",
          className,
        )}
      >
        <MapPinIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">{pick(current.name, locale)}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {cities.map((c) => (
          <DropdownMenuItem
            key={c.slug}
            onClick={() => choose(c.slug)}
            aria-current={c.slug === current.slug ? "true" : undefined}
          >
            <span className="flex-1">{pick(c.name, locale)}</span>
            {c.slug === current.slug ? <CheckIcon className="size-4" aria-hidden="true" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
