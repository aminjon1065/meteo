"use client";

import type { I18nText, Locale } from "@meteo/i18n";
import { pick } from "@meteo/i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@meteo/ui/components/dropdown-menu";
import { cn } from "@meteo/ui/lib/utils";
import { CheckIcon, ChevronDownIcon, MapPinIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useTransition } from "react";
import { useRouter } from "@/i18n/navigation";

export interface CityChoice {
  slug: string;
  name: I18nText;
  /** Код области точки прогноза (DU, SU, KT, GB, RRP) — по нему города сгруппированы в списке. */
  region?: string | null;
}

/** Порядок областей в списке: Душанбе, Согд, Хатлон, ГБАО, РРП; города без области — в конце, без заголовка. */
const REGION_ORDER = ["DU", "SU", "KT", "GB", "RRP"] as const;
type RegionCode = (typeof REGION_ORDER)[number];

function isRegionCode(code: string | null | undefined): code is RegionCode {
  return (REGION_ORDER as readonly (string | null | undefined)[]).includes(code);
}

function groupByRegion(cities: CityChoice[]) {
  const groups: { code: RegionCode | null; cities: CityChoice[] }[] = REGION_ORDER.map((code) => ({
    code,
    cities: cities.filter((c) => c.region === code),
  })).filter((g) => g.cities.length > 0);
  const rest = cities.filter((c) => !isRegionCode(c.region));
  if (rest.length > 0) groups.push({ code: null, cities: rest });
  return groups;
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
  const groups = groupByRegion(cities);

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
          "inline-flex h-9 max-w-[8.5rem] min-w-0 items-center gap-1.5 rounded-full border bg-card pr-2.5 pl-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted data-pending:opacity-70 min-[380px]:max-w-[11rem] sm:max-w-none",
          className,
        )}
      >
        <MapPinIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">{pick(current.name, locale)}</span>
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        {groups.map((g, i) => (
          <Fragment key={g.code ?? "other"}>
            {i > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuGroup>
              {/* Душанбе — город республиканского значения: заголовок «Душанбе» над единственным
                  пунктом «Душанбе» лишний. У остальных областей заголовок — короткое название. */}
              {g.code && g.code !== "DU" ? (
                <DropdownMenuLabel>{t(`regionShort.${g.code}`)}</DropdownMenuLabel>
              ) : null}
              {g.cities.map((c) => (
                <DropdownMenuItem
                  key={c.slug}
                  onClick={() => choose(c.slug)}
                  aria-current={c.slug === current.slug ? "true" : undefined}
                >
                  <span className="flex-1">{pick(c.name, locale)}</span>
                  {c.slug === current.slug ? (
                    <CheckIcon className="size-4" aria-hidden="true" />
                  ) : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
