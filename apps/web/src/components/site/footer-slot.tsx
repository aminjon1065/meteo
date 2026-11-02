"use client";

import type { ReactNode } from "react";
import { usePathname } from "@/i18n/navigation";

/** Подвал на всех страницах, кроме главной: там карта на весь экран под шапкой, без прокрутки. */
export function FooterSlot({ children }: { children: ReactNode }) {
  return usePathname() === "/" ? null : children;
}
