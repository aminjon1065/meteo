import { defaultLocale, locales } from "@meteo/i18n";
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales,
  defaultLocale,
  // tg — без префикса (/), остальные — /ru/…, /en/…
  localePrefix: "as-needed",
  localeCookie: { name: "meteo_locale" },
  // «/» всегда на государственном языке; выбор языка — явный, через переключатель (как на meteo.tj)
  localeDetection: false,
});
