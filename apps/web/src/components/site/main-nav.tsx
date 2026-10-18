"use client";

import { cn } from "@meteo/ui/lib/utils";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

export interface NavItem {
  href: string;
  label: string;
  /** Раздел ещё не реализован — показываем неактивным. */
  soon?: boolean;
}

export function MainNav({ items, className }: { items: NavItem[]; className?: string }) {
  const pathname = usePathname();
  const t = useTranslations("common");
  return (
    <nav className={cn("items-center gap-1", className)} aria-label={t("mainNav")}>
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        if (item.soon) {
          return (
            <span
              key={item.href}
              aria-disabled="true"
              className="cursor-not-allowed rounded-md px-3 py-2 text-sm text-muted-foreground/60"
              title={t("soon")}
            >
              {item.label}
            </span>
          );
        }
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
              active ? "bg-accent text-accent-foreground" : "text-foreground/80",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
