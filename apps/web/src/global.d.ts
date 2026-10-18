import type messages from "@meteo/i18n/messages/tg.json";
import type { routing } from "@/i18n/routing";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing)["locales"][number];
    Messages: typeof messages;
  }
}
