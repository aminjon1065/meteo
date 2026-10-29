import { afterEach, describe, expect, it } from "vitest";
import {
  calendarNames,
  type DateFormatOptions,
  dateFormatter,
  formatRelativeTime,
} from "@/lib/date-format";

/**
 * Даты для tg собираются без данных Intl этого языка (их нет в Chrome) и должны совпадать с тем,
 * что Node (полный ICU) выдаёт для «tg»: так подписи, отрисованные сервером и браузером, одинаковы.
 */

const TZ = "Asia/Dushanbe";

/** Даты на все месяцы и дни недели, полночь и полдень по Душанбе, переход через год. */
const DATES = [
  ...Array.from({ length: 12 }, (_, m) => new Date(Date.UTC(2026, m, 1 + m * 2, 7, 5))),
  ...Array.from({ length: 7 }, (_, d) => new Date(Date.UTC(2026, 9, 25 + d, 12, 30))),
  new Date("2026-10-28T19:00:00Z"), // 00:00 29.10 по Душанбе
  new Date("2026-12-31T19:30:00Z"), // 00:30 01.01.2027 по Душанбе
];

function nodeTg(options: Intl.DateTimeFormatOptions, date: Date): string {
  return new Intl.DateTimeFormat("tg", { timeZone: TZ, ...options }).format(date);
}

/** Поля, у которых CLDR для tg даёт служебные шаблоны вроде «2026 (рӯз: 5)» — на портале их нет. */
function unsupported(o: FieldCombo): boolean {
  if (o.year && !o.month) return true;
  if (o.weekday && o.month && !o.day) return true;
  return false;
}

type FieldCombo = Pick<DateFormatOptions, "weekday" | "day" | "month" | "year"> & {
  time: boolean;
};

const combos: FieldCombo[] = [];
for (const weekday of [undefined, "short", "long"] as const)
  for (const day of [undefined, "numeric"] as const)
    for (const month of [undefined, "short", "long"] as const)
      for (const year of [undefined, "numeric"] as const)
        for (const time of [false, true]) {
          if (weekday || day || month || year) combos.push({ weekday, day, month, year, time });
        }

describe("dateFormatter: tg как у Node", () => {
  it("Node в тестах знает tg (иначе сверка бессмысленна)", () => {
    expect(new Intl.DateTimeFormat("tg").resolvedOptions().locale).toBe("tg");
  });

  for (const combo of combos.filter((c) => !unsupported(c))) {
    const { time, ...fields } = combo;
    const options = {
      ...fields,
      ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
    } as DateFormatOptions;
    it(JSON.stringify(options), () => {
      const fmt = dateFormatter("tg", options);
      for (const date of DATES) expect(fmt.format(date)).toBe(nodeTg(options, date));
    });
  }

  for (const options of [
    { dateStyle: "short" },
    { dateStyle: "medium" },
    { dateStyle: "long" },
    { dateStyle: "short", timeStyle: "short" },
    { dateStyle: "medium", timeStyle: "short" },
    { dateStyle: "long", timeStyle: "short" },
    { timeStyle: "short" },
    { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" },
  ] satisfies DateFormatOptions[]) {
    it(JSON.stringify(options), () => {
      const fmt = dateFormatter("tg", options);
      for (const date of DATES) expect(fmt.format(date)).toBe(nodeTg(options, date));
    });
  }

  it("подписи карты и графиков", () => {
    const at = new Date("2026-10-29T12:00:00Z");
    const label = { weekday: "short", day: "numeric", month: "short" } as const;
    expect(dateFormatter("tg", { ...label, hour: "2-digit", minute: "2-digit" }).format(at)).toBe(
      "Пшб, 29 Окт, 17:00",
    );
    expect(
      dateFormatter("tg", {
        timeZone: "UTC",
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date("2026-10-28T00:00:00Z")),
    ).toBe("28 Окт, 00:00");
    expect(dateFormatter("tg", { weekday: "short", day: "numeric" }).format(at)).toBe("29, Пшб");
    expect(dateFormatter("tg", { dateStyle: "medium" }).format(at)).toBe("29 Окт 2026");
  });
});

describe("dateFormatter: браузер без данных Intl для tg", () => {
  const Original = Intl.DateTimeFormat;
  afterEach(() => {
    Intl.DateTimeFormat = Original;
  });

  it("таджикская подпись не зависит от Intl для tg", () => {
    // Как в Chrome: запрошенный tg тихо становится английским.
    class Fallback extends Original {
      constructor(locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
        const asked = Array.isArray(locales) ? locales[0] : locales;
        super(asked?.startsWith("tg") ? "en-US" : locales, options);
      }
    }
    Intl.DateTimeFormat = Fallback as typeof Intl.DateTimeFormat;
    expect(new Intl.DateTimeFormat("tg", { month: "short" }).format(0)).toBe("Jan");

    // Пояс, которого ещё нет в кэше помощника: форматтер частей создаётся при подменённом Intl.
    const fmt = dateFormatter("tg", {
      timeZone: "Asia/Samarkand",
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(fmt.format(new Date("2026-10-29T12:00:00Z"))).toBe("Пшб, 29 Окт, 17:00");
  });
});

describe("dateFormatter: ru и en — Intl", () => {
  it("по умолчанию время Душанбе", () => {
    const options = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" } as const;
    const at = new Date("2026-10-29T12:00:00Z");
    expect(dateFormatter("ru", options).format(at)).toBe(
      new Intl.DateTimeFormat("ru", { timeZone: TZ, ...options }).format(at),
    );
    expect(dateFormatter("en", options).format(at)).toBe(
      new Intl.DateTimeFormat("en", { timeZone: TZ, ...options }).format(at),
    );
    expect(dateFormatter("ru", { ...options, timeZone: "UTC" }).format(at)).toBe("29 окт., 12:00");
  });
});

describe("calendarNames", () => {
  it("tg — как у Node", () => {
    const names = calendarNames("tg");
    const month = (options: Intl.DateTimeFormatOptions) =>
      Array.from({ length: 12 }, (_, i) =>
        new Intl.DateTimeFormat("tg", { timeZone: "UTC", ...options }).format(
          Date.UTC(2026, i, 15),
        ),
      );
    const weekday = (options: Intl.DateTimeFormatOptions) =>
      Array.from({ length: 7 }, (_, i) =>
        new Intl.DateTimeFormat("tg", { timeZone: "UTC", ...options }).format(
          Date.UTC(2026, 0, 4 + i),
        ),
      );
    expect(names.month).toEqual(month({ month: "long" }));
    expect(names.monthAbbr).toEqual(month({ month: "short" }));
    expect(names.dayOfWeek).toEqual(weekday({ weekday: "long" }));
    expect(names.dayOfWeekAbbr).toEqual(weekday({ weekday: "short" }));
  });

  it("ru и en — от Intl, с воскресенья", () => {
    expect(calendarNames("ru").monthAbbr[9]).toBe("окт.");
    expect(calendarNames("en").dayOfWeekAbbr[0]).toBe("Sun");
    expect(calendarNames("ru").dayOfWeek[0]).toBe("воскресенье");
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-10-29T12:00:00Z").getTime();
  const offsets = [
    0, -0.4, 0.4, -5, 5, -59, -60, -61, 90, -3599, -3600, 7200, -86_399, -86_400, 172_800, -604_800,
    1_209_600, -2_628_000, 5_256_000, -31_536_000, 63_072_000,
  ];

  it("tg — как Intl.RelativeTimeFormat у Node с правилами next-intl", () => {
    for (const s of offsets) {
      const date = now + s * 1000;
      // Те же единица и число, что выбирает next-intl, через Intl Node.
      const abs = Math.abs(s);
      const [unit, size] =
        abs < 60
          ? (["second", 1] as const)
          : abs < 3600
            ? (["minute", 60] as const)
            : abs < 86_400
              ? (["hour", 3600] as const)
              : abs < 604_800
                ? (["day", 86_400] as const)
                : abs < 2_628_000
                  ? (["week", 604_800] as const)
                  : abs < 31_536_000
                    ? (["month", 2_628_000] as const)
                    : (["year", 31_536_000] as const);
      const expected = new Intl.RelativeTimeFormat("tg", {
        numeric: unit === "second" ? "auto" : "always",
      }).format(Math.round(s / size), unit);
      expect(formatRelativeTime("tg", date, now), String(s)).toBe(expected);
    }
  });

  it("ru и en — Intl", () => {
    expect(formatRelativeTime("ru", now - 5 * 60_000, now)).toBe("5 минут назад");
    expect(formatRelativeTime("en", now + 2 * 3_600_000, now)).toBe("in 2 hours");
    expect(formatRelativeTime("en", now, now)).toBe("now");
  });
});
