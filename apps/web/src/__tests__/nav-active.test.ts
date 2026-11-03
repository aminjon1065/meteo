import { describe, expect, it } from "vitest";
import { activeNavHref, isActivePath } from "@/components/site/nav-active";

// Меню ☰ (site-header.tsx): «Карта» — главная.
const MENU = [
  "/warnings",
  "/weather",
  "/air/silam",
  "/air",
  "/",
  "/news",
  "/health",
  "/data",
  "/about",
];

describe("подсветка пунктов меню", () => {
  it("«Главная» только на корне, остальные - по префиксу", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/air", "/")).toBe(false);
    expect(isActivePath("/air/stations/x", "/air")).toBe(true);
    expect(isActivePath("/airport", "/air")).toBe(false);
  });

  it("на вложенном разделе подсвечивается он, а не родительский", () => {
    expect(activeNavHref("/air/silam", MENU)).toBe("/air/silam");
    expect(activeNavHref("/air/stations/dushanbe", MENU)).toBe("/air");
    expect(activeNavHref("/", MENU)).toBe("/");
    expect(activeNavHref("/weather/dushanbe", MENU)).toBe("/weather");
    expect(activeNavHref("/subscribe", MENU)).toBeNull();
  });
});
