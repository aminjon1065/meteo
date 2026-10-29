"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLinkItem,
  DropdownMenuTrigger,
} from "@meteo/ui/components/dropdown-menu";
import { cn } from "@meteo/ui/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { activeNavHref } from "./nav-active";

export { activeNavHref, isActivePath } from "./nav-active";

export interface NavItem {
  href: string;
  label: string;
}

/** Раздел верхнего меню с выпадающим списком (например, «Мониторинг»: воздух и погода). */
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export type NavEntry = NavItem | NavGroup;

export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return "items" in entry;
}

/** Все адреса меню, включая пункты выпадающих списков. */
export function navHrefs(entries: readonly NavEntry[]): string[] {
  return entries.flatMap((e) => (isNavGroup(e) ? e.items.map((i) => i.href) : [e.href]));
}

const ITEM_CLASS =
  "rounded-lg px-2 py-2 text-[13px] font-medium whitespace-nowrap transition-colors hover:bg-muted hover:text-foreground";

/**
 * Верхнее меню в строке шапки шириной до 74rem: компактный кегль и отступы, без переноса подписей.
 * Группа открывается кликом или наведением; подсвечена, если текущая страница — один из её пунктов.
 */
export function MainNav({ items, className }: { items: NavEntry[]; className?: string }) {
  const pathname = usePathname();
  const t = useTranslations("common");
  const current = activeNavHref(pathname, navHrefs(items));
  return (
    <nav className={cn("items-center gap-0.5", className)} aria-label={t("mainNav")}>
      {items.map((entry) => {
        if (isNavGroup(entry)) {
          const active = entry.items.some((i) => i.href === current);
          return (
            <DropdownMenu key={entry.label}>
              <DropdownMenuTrigger
                openOnHover
                delay={80}
                closeDelay={150}
                className={cn(
                  ITEM_CLASS,
                  "inline-flex items-center gap-1 data-popup-open:bg-muted data-popup-open:text-foreground",
                  active ? "bg-muted text-foreground" : "text-muted-foreground",
                )}
              >
                {entry.label}
                <ChevronDownIcon className="size-3.5 opacity-70" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-auto min-w-44">
                {entry.items.map((item) => (
                  <DropdownMenuLinkItem
                    key={item.href}
                    render={<Link href={item.href} />}
                    aria-current={item.href === current ? "page" : undefined}
                    className={cn("px-2.5 py-2", item.href === current && "font-semibold")}
                  >
                    {item.label}
                  </DropdownMenuLinkItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        }
        const active = entry.href === current;
        return (
          <Link
            key={entry.href}
            href={entry.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              ITEM_CLASS,
              active ? "bg-muted text-foreground" : "text-muted-foreground",
            )}
          >
            {entry.label}
          </Link>
        );
      })}
    </nav>
  );
}
