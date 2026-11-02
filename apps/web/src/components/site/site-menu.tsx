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
  CloudFogIcon,
  CloudSunIcon,
  CodeXmlIcon,
  HeartPulseIcon,
  InfoIcon,
  type LucideIcon,
  MapIcon,
  MenuIcon,
  NewspaperIcon,
  TriangleAlertIcon,
  WindIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { LanguageSwitcher } from "./language-switcher";
import { activeNavHref } from "./nav-active";
import { ThemeToggle } from "./theme-toggle";

export interface NavItem {
  href: string;
  label: string;
}

const ICONS: Record<string, LucideIcon> = {
  "/warnings": TriangleAlertIcon,
  "/weather": CloudSunIcon,
  "/air/silam": CloudFogIcon,
  "/air": WindIcon,
  "/": MapIcon,
  "/news": NewspaperIcon,
  "/health": HeartPulseIcon,
  "/data": CodeXmlIcon,
  "/about": InfoIcon,
};

/**
 * Меню портала — кнопка ☰ в шапке и боковая панель (по образцу data.meteo.uz, просьба Заказчика
 * 31.10.2026): основные разделы со значками, ниже — справочные, язык, тема и партнёр проекта.
 * Одно меню на всех страницах и ширинах экрана.
 */
export function SiteMenu({
  items,
  more,
  credit,
}: {
  items: NavItem[];
  more: NavItem[];
  /** Блок «Проект FINTAJ при поддержке FMI» внизу панели (на главной подвала нет). */
  credit?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const t = useTranslations("common");
  // Один подсвеченный пункт на всё меню: самый точный по адресу.
  const current = activeNavHref(
    pathname,
    [...items, ...more].map((i) => i.href),
  );
  const link = (item: NavItem, className: string, icon?: LucideIcon) => {
    const Icon = icon;
    const active = item.href === current;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setOpen(false)}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 transition-colors hover:bg-muted",
          active && "bg-muted text-foreground",
          className,
        )}
      >
        {Icon ? <Icon className="size-5 shrink-0 text-brand" aria-hidden="true" /> : null}
        {item.label}
      </Link>
    );
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        aria-label={t("menu")}
        aria-haspopup="dialog"
        className="-ml-1.5 inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted"
      >
        <MenuIcon className="size-6" aria-hidden="true" />
      </SheetTrigger>
      <SheetContent side="left" className="w-80 max-w-[85vw] gap-0 overflow-y-auto">
        <SheetHeader className="border-b">
          <SheetTitle className="font-semibold">{t("menu")}</SheetTitle>
        </SheetHeader>
        <nav aria-label={t("mainNav")} className="flex flex-col gap-0.5 p-2">
          {items.map((item) =>
            link(item, "py-2.5 text-[0.95rem] font-medium", ICONS[item.href] ?? InfoIcon),
          )}
          <hr className="mx-3 my-2" />
          {more.map((item) => link(item, "py-2 text-sm text-muted-foreground"))}
        </nav>
        <div className="mt-auto flex flex-col gap-4 border-t p-4">
          <div className="flex items-center justify-between gap-3">
            <LanguageSwitcher variant="inline" />
            <ThemeToggle />
          </div>
          {credit}
        </div>
      </SheetContent>
    </Sheet>
  );
}
