"use client";

import { cn } from "@meteo/ui/lib/utils";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

export interface NavItem {
  href: string;
  label: string;
}

/** Текущий раздел: «Главная» только на корне, остальные — по префиксу пути. */
export function isActivePath(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function MainNav({ items, className }: { items: NavItem[]; className?: string }) {
  const pathname = usePathname();
  const t = useTranslations("common");
  return (
    <nav className={cn("items-center gap-0.5", className)} aria-label={t("mainNav")}>
      {items.map((item) => {
        const active = isActivePath(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-muted hover:text-foreground",
              active ? "bg-muted text-foreground" : "text-muted-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
