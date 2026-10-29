"use client";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@meteo/ui/components/sheet";
import { cn } from "@meteo/ui/lib/utils";
import {
  CloudSunIcon,
  HouseIcon,
  type LucideIcon,
  MapIcon,
  MenuIcon,
  WindIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { LanguageSwitcher } from "./language-switcher";
import { activeNavHref, type NavItem } from "./main-nav";
import { ThemeToggle } from "./theme-toggle";

const ICONS: Record<string, LucideIcon> = {
  "/": HouseIcon,
  "/air": WindIcon,
  "/weather": CloudSunIcon,
  "/map": MapIcon,
};

/**
 * Нижняя навигация на телефоне (docs/03 §3): четыре главных раздела и «Ещё» —
 * лист с остальными разделами, языком и темой. На десктопе скрыта (lg:hidden).
 */
export function MobileNav({ primary, more }: { primary: NavItem[]; more: NavItem[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const t = useTranslations("common");
  // Один подсвеченный пункт на всё меню: самый точный по адресу среди нижней панели и листа «Ещё».
  const current = activeNavHref(
    pathname,
    [...primary, ...more].map((i) => i.href),
  );
  const moreActive =
    !primary.some((i) => i.href === current) && more.some((i) => i.href === current);
  const itemClass = (active: boolean) =>
    cn(
      "flex min-w-0 flex-col items-center gap-0.5 rounded-lg px-1 pt-2 pb-1.5 text-[0.7rem] leading-tight font-medium",
      active ? "text-primary" : "text-muted-foreground",
    );

  return (
    <nav
      aria-label={t("menu")}
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-card/95 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur lg:hidden"
    >
      {primary.map((item) => {
        const Icon = ICONS[item.href] ?? HouseIcon;
        const active = item.href === current;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={itemClass(active)}
          >
            <Icon className="size-5" aria-hidden="true" />
            <span className="max-w-full truncate">{item.label}</span>
          </Link>
        );
      })}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger
          className={itemClass(moreActive)}
          aria-label={t("more")}
          aria-haspopup="dialog"
        >
          <MenuIcon className="size-5" aria-hidden="true" />
          <span className="max-w-full truncate">{t("more")}</span>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <SheetHeader>
            <SheetTitle>{t("menu")}</SheetTitle>
          </SheetHeader>
          <nav className="grid grid-cols-2 gap-1 px-4" aria-label={t("menu")}>
            {more.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={item.href === current ? "page" : undefined}
                className={cn(
                  "rounded-lg px-3 py-2.5 text-base font-medium hover:bg-muted",
                  item.href === current && "bg-muted",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mt-3 flex items-center justify-between gap-3 border-t px-4 pt-3">
            <LanguageSwitcher variant="inline" />
            <ThemeToggle />
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
