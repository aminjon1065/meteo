"use client";

import { type Locale, localeNames, locales } from "@meteo/i18n";
import { Button } from "@meteo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@meteo/ui/components/dropdown-menu";
import { CheckIcon, GlobeIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("common");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            // Доступное имя содержит видимый текст (код локали) — правило label-content-name-mismatch.
            aria-label={`${locale.toUpperCase()} · ${t("language")}`}
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
