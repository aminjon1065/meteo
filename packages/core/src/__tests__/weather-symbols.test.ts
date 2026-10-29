import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { symbol3ToSmart } from "../smartmet";
import { SYMBOL_KEYS, symbolKey, symbolPath } from "../weather-symbols";

const ROOT = resolve(__dirname, "../../../..");

describe("SmartSymbol по таблице FMI", () => {
  it("коды дождя, мокрого снега, снега и града", () => {
    expect(symbolKey(31)).toBe("lightRainPeriods");
    expect(symbolKey(34)).toBe("lightRainPeriods");
    expect(symbolKey(137)).toBe("lightRain");
    expect(symbolKey(41)).toBe("lightSleetShowers");
    expect(symbolKey(48)).toBe("sleet");
    expect(symbolKey(54)).toBe("lightSnowShowers");
    expect(symbolKey(157)).toBe("lightSnow");
    expect(symbolKey(59)).toBe("heavySnow");
    expect(symbolKey(64)).toBe("scatteredHailShowers");
    expect(symbolKey(77)).toBe("thunderShowers");
    expect(symbolKey(3)).toBe("unknown");
  });

  it("WeatherSymbol3 → SmartSymbol той же категории", () => {
    expect(symbol3ToSmart(31)).toBe(37);
    expect(symbol3ToSmart(41)).toBe(51);
    expect(symbol3ToSmart(51)).toBe(57);
    expect(symbol3ToSmart(61)).toBe(71);
    expect(symbol3ToSmart(71)).toBe(41);
    expect(symbol3ToSmart(83)).toBe(49);
    expect(symbol3ToSmart(5)).toBeNull();
  });

  it("у каждого кода есть иконка (день и ночь) и перевод на tg, ru, en", () => {
    const keys = new Set([...Object.values(SYMBOL_KEYS), "unknown"]);
    for (const locale of ["tg", "ru", "en"]) {
      const messages = JSON.parse(
        readFileSync(resolve(ROOT, `packages/i18n/messages/${locale}.json`), "utf8"),
      ) as { weatherSymbols: Record<string, string> };
      for (const key of keys) expect(messages.weatherSymbols[key], `${locale}:${key}`).toBeTruthy();
    }
    for (const code of Object.keys(SYMBOL_KEYS).map(Number)) {
      for (const c of [code, code + 100]) {
        const path = symbolPath(c, "light");
        expect(path).not.toBeNull();
        expect(existsSync(resolve(ROOT, `apps/web/public${path}`)), String(c)).toBe(true);
      }
    }
  });
});
