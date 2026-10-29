import { describe, expect, it } from "vitest";
import { activeNavHref, isActivePath } from "@/components/site/nav-active";

const MENU = ["/", "/air", "/weather", "/map", "/air/silam", "/warnings", "/news"];

describe("подсветка пунктов меню", () => {
  it("«Главная» только на корне, остальные — по префиксу", () => {
    expect(isActivePath("/", "/")).toBe(true);
    expect(isActivePath("/air", "/")).toBe(false);
    expect(isActivePath("/air/stations/x", "/air")).toBe(true);
    expect(isActivePath("/airport", "/air")).toBe(false);
  });

  it("на вложенном разделе подсвечивается он, а не родительский", () => {
    expect(activeNavHref("/air/silam", MENU)).toBe("/air/silam");
    expect(activeNavHref("/air/stations/dushanbe", MENU)).toBe("/air");
    expect(activeNavHref("/map", MENU)).toBe("/map");
    expect(activeNavHref("/about", MENU)).toBeNull();
  });
});
