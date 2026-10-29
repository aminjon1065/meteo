/**
 * Символы FMI SmartSymbol → ключи переводов (weatherSymbols.<key>) и SVG‑файлы.
 * Таблица кодов — руководство FMI (apps/web/public/weather-symbols/README.md, fmidev/opendata-resources):
 * 1 ясно, 2 малооблачно, 4 переменная облачность, 6 облачно, 7 пасмурно, 9 туман,
 * 11 морось, 14 замерзающая морось, 17 замерзающий дождь, 21/24/27 ливни (местами/временами/везде),
 * 31–36 временами дождь (небольшой/умеренный/сильный), 37/38/39 дождь,
 * 41–46 ливневый мокрый снег, 47/48/49 мокрый снег, 51–56 ливневый снег, 57/58/59 снегопад,
 * 61/64/67 ливни с градом, 71/74/77 ливни с грозой. Ночные варианты — код + 100.
 */
export const SYMBOL_KEYS: Record<number, string> = {
  1: "clear",
  2: "mostlyClear",
  4: "partlyCloudy",
  6: "mostlyCloudy",
  7: "overcast",
  9: "fog",
  11: "drizzle",
  14: "freezingDrizzle",
  17: "freezingRain",
  21: "isolatedShowers",
  24: "scatteredShowers",
  27: "showers",
  31: "lightRainPeriods",
  32: "rainPeriods",
  33: "heavyRainPeriods",
  34: "lightRainPeriods",
  35: "rainPeriods",
  36: "heavyRainPeriods",
  37: "lightRain",
  38: "rain",
  39: "heavyRain",
  41: "lightSleetShowers",
  42: "sleetShowers",
  43: "heavySleetShowers",
  44: "lightSleetShowers",
  45: "sleetShowers",
  46: "heavySleetShowers",
  47: "lightSleet",
  48: "sleet",
  49: "heavySleet",
  51: "lightSnowShowers",
  52: "snowShowers",
  53: "heavySnowShowers",
  54: "lightSnowShowers",
  55: "snowShowers",
  56: "heavySnowShowers",
  57: "lightSnow",
  58: "snow",
  59: "heavySnow",
  61: "isolatedHailShowers",
  64: "scatteredHailShowers",
  67: "hailShowers",
  71: "isolatedThunderShowers",
  74: "scatteredThunderShowers",
  77: "thunderShowers",
};

/** Ключ перевода для кода (ночной код приводится к дневному). */
export function symbolKey(code: number | null | undefined): string {
  if (code === null || code === undefined) return "unknown";
  const day = code >= 100 ? code - 100 : code;
  return SYMBOL_KEYS[day] ?? "unknown";
}

/** Путь к SVG символа (/weather-symbols/{theme}/{code}.svg); при отсутствии ночного варианта — дневной. */
export function symbolPath(
  code: number | null | undefined,
  theme: "light" | "dark" = "light",
): string | null {
  if (code === null || code === undefined) return null;
  const day = code >= 100 ? code - 100 : code;
  if (!SYMBOL_KEYS[day]) return null;
  return `/weather-symbols/${theme}/${code}.svg`;
}
