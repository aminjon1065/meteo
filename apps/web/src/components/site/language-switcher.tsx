"use client";

import { type Locale, localeNames, locales } from "@meteo/i18n";
import { Button } from "@meteo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@meteo/ui/components/dropdown-menu";
import { cn } from "@meteo/ui/lib/utils";
import { CheckIcon, GlobeIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";

/** Короткие коды языков в шапке портала («TJ · RU · EN» по макету). */
const CODES: Record<Locale, string> = { tg: "TJ", ru: "RU", en: "EN" };

/**
 * Переключатель языка. inline — три ссылки в строку (публичная шапка и подвал);
 * menu — компактная кнопка с выпадающим списком (админка).
 */
export function LanguageSwitcher({
  variant = "menu",
  className,
}: {
  variant?: "inline" | "menu";
  className?: string;
}) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("common");

  if (variant === "inline") {
    return (
      <nav aria-label={t("language")} className={cn("flex items-center", className)}>
        {locales.map((l: Locale, i) => (
          <span key={l} className="flex items-center">
            {i > 0 ? (
              <span className="px-1 text-muted-foreground/60" aria-hidden="true">
                ·
              </span>
            ) : null}
            <Link
              href={pathname}
              locale={l}
              lang={l}
              hrefLang={l}
              aria-label={`${CODES[l]} · ${localeNames[l]}`}
              aria-current={l === locale ? "true" : undefined}
              className={cn(
                "rounded-md px-1 py-1 text-sm font-semibold tracking-[0.04em] transition-colors hover:text-foreground",
                l === locale ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {CODES[l]}
            </Link>
          </span>
        ))}
      </nav>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            // Доступное имя содержит видимый текст (код локали) — правило label-content-name-mismatch.
            aria-label={`${locale.toUpperCase()} · ${t("language")}`}
            className={className}
          />
        }
      >
        <GlobeIcon aria-hidden="true" />
        <span className="uppercase">{locale}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        {locales.map((l: Locale) => (
          <DropdownMenuItem
            key={l}
            onClick={() => router.replace(pathname, { locale: l })}
            aria-current={l === locale ? "true" : undefined}
            lang={l}
          >
            <span className="flex-1">{localeNames[l]}</span>
            {l === locale ? <CheckIcon className="size-4" aria-hidden="true" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
