import { displayTimeZone } from "@meteo/i18n";
import en from "@meteo/i18n/messages/en.json";
import ru from "@meteo/i18n/messages/ru.json";
import tg from "@meteo/i18n/messages/tg.json";
import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

const messages = { tg, ru, en } as const;

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: messages[locale],
    timeZone: displayTimeZone,
  };
});
