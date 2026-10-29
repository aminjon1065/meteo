import { afterEach, describe, expect, it } from "vitest";
import { type NumberFormatOptions, numberFormatter } from "@/lib/number-format";

/**
 * Числа для tg собираются без данных Intl этого языка (их нет в Chrome) и должны совпадать с тем,
 * что Node (полный ICU) выдаёт для «tg».
 */

const VALUES = [
  0,
  -0,
  0.5,
  1,
  -1,
  7.25,
  -3.25,
  12.345,
  999.95,
  1000,
  1234.5,
  -1234.5,
  12_345_678.9,
  0.004,
  -0.04,
  1e21,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
];

const OPTIONS: NumberFormatOptions[] = [
  {},
  { maximumFractionDigits: 0 },
  { maximumFractionDigits: 1 },
  { maximumFractionDigits: 2 },
  { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  { useGrouping: false },
  { minimumIntegerDigits: 2 },
  { signDisplay: "always", maximumFractionDigits: 1 },
  { signDisplay: "exceptZero" },
  { style: "percent" },
  { style: "percent", maximumFractionDigits: 1 },
];

describe("numberFormatter: tg как у Node", () => {
  it("Node в тестах знает tg", () => {
    expect(new Intl.NumberFormat("tg").resolvedOptions().locale).toBe("tg");
  });

  for (const options of OPTIONS) {
    it(JSON.stringify(options), () => {
      const fmt = numberFormatter("tg", options);
      const node = new Intl.NumberFormat("tg", options);
      for (const v of VALUES) expect(fmt.format(v), String(v)).toBe(node.format(v));
    });
  }

  it("подписи шкал и подсказок", () => {
    expect(numberFormatter("tg", { maximumFractionDigits: 1 }).format(19.84)).toBe("19,8");
    expect(numberFormatter("tg").format(1000)).toBe("1 000");
    expect(numberFormatter("tg").format(-30)).toBe("-30");
  });
});

describe("numberFormatter: браузер без данных Intl для tg", () => {
  const Original = Intl.NumberFormat;
  afterEach(() => {
    Intl.NumberFormat = Original;
  });

  it("таджикское число не зависит от Intl для tg", () => {
    // Как в Chrome: запрошенный tg тихо становится английским.
    class Fallback extends Original {
      constructor(locales?: string | string[], options?: Intl.NumberFormatOptions) {
        const asked = Array.isArray(locales) ? locales[0] : locales;
        super(asked?.startsWith("tg") ? "en-US" : locales, options);
      }
    }
    Intl.NumberFormat = Fallback as typeof Intl.NumberFormat;
    expect(new Intl.NumberFormat("tg").format(1234.5)).toBe("1,234.5");
    expect(numberFormatter("tg").format(1234.5)).toBe("1 234,5");
  });
});

describe("numberFormatter: ru и en — Intl", () => {
  it("как Intl.NumberFormat", () => {
    for (const locale of ["ru", "en"]) {
      for (const options of OPTIONS) {
        const fmt = numberFormatter(locale, options);
        const intl = new Intl.NumberFormat(locale, options);
        for (const v of VALUES) expect(fmt.format(v)).toBe(intl.format(v));
      }
    }
  });
});
