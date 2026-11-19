"use client";

import type { ReactNode } from "react";
import { usePathname } from "@/i18n/navigation";

/** Страницы с картой на весь экран под шапкой, без прокрутки и подвала: главная и Meteo Alert. */
const FULLSCREEN = new Set(["/", "/meteo-alert"]);

/** Подвал на всех страницах, кроме полноэкранных карт. */
export function FooterSlot({ children }: { children: ReactNode }) {
  return FULLSCREEN.has(usePathname()) ? null : children;
}
