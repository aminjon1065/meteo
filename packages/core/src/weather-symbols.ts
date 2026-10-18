/**
 * Группы символов FMI SmartSymbol → ключи переводов (weatherSymbols.<key>) и SVG‑файлы.
 * Коды: 1 ясно, 2 малооблачно, 4 переменная облачность, 6 облачно, 7 пасмурно, 9 туман,
 * 11 морось, 14 замерзающая морось, 17 замерзающий дождь, 21/24/27 ливни, 31/32/33 дождь,
 * 34/35/36 дождь со снегом ливневой, 37/38/39 дождь со снегом, 41/42/43 снег ливневой, 51/52/53 снег,
 * 61/64/67 гроза (ливневая), 71/74/77 грозовой дождь. Ночные варианты — код + 100.
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
  31: "lightRain",
  32: "rain",
  33: "heavyRain",
  34: "lightSleetShowers",
  35: "sleetShowers",
  36: "heavySleetShowers",
  37: "lightSleet",
  38: "sleet",
  39: "heavySleet",
  41: "lightSnowShowers",
  42: "snowShowers",
  43: "heavySnowShowers",
  51: "lightSnow",
  52: "snow",
  53: "heavySnow",
  61: "isolatedThunderstorms",
  64: "scatteredThunderstorms",
  67: "thunderstorms",
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
