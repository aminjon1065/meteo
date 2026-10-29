"use client";

import { cn } from "@meteo/ui/lib/utils";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { activeNavHref } from "./nav-active";

export { activeNavHref, isActivePath } from "./nav-active";

export interface NavItem {
  href: string;
  label: string;
}

/** Семь разделов в строке шапки шириной до 74rem: компактный кегль и отступы, без переноса подписей. */
export function MainNav({ items, className }: { items: NavItem[]; className?: string }) {
  const pathname = usePathname();
  const t = useTranslations("common");
  const current = activeNavHref(
    pathname,
    items.map((i) => i.href),
  );
  return (
    <nav className={cn("items-center gap-0.5", className)} aria-label={t("mainNav")}>
      {items.map((item) => {
        const active = item.href === current;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-lg px-2 py-2 text-[13px] font-medium whitespace-nowrap transition-colors hover:bg-muted hover:text-foreground",
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
