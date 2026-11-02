"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@meteo/ui/components/dropdown-menu";
import { cn } from "@meteo/ui/lib/utils";
import { LayersIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { BASEMAP_FILES, BASEMAPS, type Basemap, isBasemap } from "./basemap-options";

/** Выбор подложки запоминается в браузере (на всех вкладках и визитах). */
const STORAGE_KEY = "meteo-basemap";
/** Подложки без отдельного файла тайлов — доступны всегда. */
const ALWAYS: Basemap[] = BASEMAPS.filter((b) => !BASEMAP_FILES[b]);

/** Миниатюры подложек: public/map-types/{тип}.jpg (снимки одного места у Душанбе). */
export const basemapPreview = (b: Basemap) => `/map-types/${b}.jpg`;

/**
 * Тип подложки посетителя: сохранённый выбор и список доступных вариантов. Рельеф и спутник
 * предлагаются, только если их файлы есть на сервере (HEAD /tiles/…): без них вариант скрыт, а
 * сохранённый выбор откатывается к схеме.
 */
export function useBasemap(): {
  basemap: Basemap;
  available: Basemap[];
  select: (b: Basemap) => void;
} {
  const [basemap, setBasemap] = useState<Basemap>("scheme");
  const [available, setAvailable] = useState<Basemap[]>(ALWAYS);

  useEffect(() => {
    let alive = true;
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Хранилище недоступно (приватный режим) — остаётся схема.
    }
    // Сохранённый выбор — сразу, чтобы карта не перерисовывалась после монтирования.
    if (isBasemap(saved)) setBasemap(saved);
    const optional = BASEMAPS.filter((b) => BASEMAP_FILES[b]);
    Promise.all(
      optional.map(async (b) => {
        const url = BASEMAP_FILES[b];
        if (!url) return null;
        const ok = await fetch(url, { method: "HEAD" })
          .then((r) => r.ok)
          .catch(() => false);
        return ok ? b : null;
      }),
    ).then((found) => {
      if (!alive) return;
      const list = BASEMAPS.filter((b) => ALWAYS.includes(b) || found.includes(b));
      setAvailable(list);
      setBasemap((current) => (list.includes(current) ? current : "scheme"));
    });
    return () => {
      alive = false;
    };
  }, []);

  const select = (b: Basemap) => {
    setBasemap(b);
    try {
      window.localStorage.setItem(STORAGE_KEY, b);
    } catch {
      // Не сохранилось — выбор действует до перезагрузки.
    }
  };
  return { basemap, available, select };
}

/**
 * Кнопка «Тип карты» с миниатюрой текущей подложки (как в Google Maps) и меню вариантов с
 * картинками. Пункты — radio: выбранный отмечен, стрелки и Enter работают в меню.
 */
export function BasemapPicker({
  value,
  available,
  onChange,
  labels,
  className,
}: {
  value: Basemap;
  available: Basemap[];
  onChange: (b: Basemap) => void;
  labels: { title: string } & Record<Basemap, string>;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${labels.title}: ${labels[value]}`}
        data-testid="basemap-picker"
        className={cn(
          "group relative block size-11 overflow-hidden rounded-xl border-2 border-card bg-card shadow-md outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-16 md:w-[4.75rem]",
          className,
        )}
      >
        {/* biome-ignore lint/performance/noImgElement: статическая миниатюра из public */}
        <img
          src={basemapPreview(value)}
          alt=""
          aria-hidden="true"
          className="size-full object-cover transition-transform group-hover:scale-105"
        />
        <span className="absolute inset-x-0 bottom-0 hidden items-center justify-center gap-1 bg-black/55 py-0.5 text-[10px] font-semibold whitespace-nowrap text-white md:flex">
          <LayersIcon className="size-3" aria-hidden="true" />
          {labels.title}
        </span>
        <LayersIcon
          className="absolute right-1 bottom-1 size-3.5 rounded bg-black/55 p-0.5 text-white md:hidden"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" sideOffset={8} className="w-auto p-2">
        {/* Подпись меню в Base UI работает только внутри группы. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="px-1 pb-2 text-xs font-semibold text-muted-foreground">
            {labels.title}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(v) => {
              if (isBasemap(v)) onChange(v);
            }}
            className="grid grid-cols-2 gap-1.5"
          >
            {available.map((b) => (
              <DropdownMenuRadioItem
                key={b}
                value={b}
                data-basemap-option={b}
                className="flex-col items-stretch gap-1 rounded-lg p-1 pr-1 data-[checked]:bg-accent"
              >
                {/* biome-ignore lint/performance/noImgElement: статическая миниатюра из public */}
                <img
                  src={basemapPreview(b)}
                  alt=""
                  aria-hidden="true"
                  className={cn(
                    "h-16 w-24 rounded-md object-cover ring-2",
                    b === value ? "ring-primary" : "ring-transparent",
                  )}
                />
                <span className="px-0.5 text-center text-xs font-medium">{labels[b]}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
