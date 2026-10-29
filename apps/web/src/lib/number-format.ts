import { isTajik } from "@/lib/date-format";

/**
 * Числа для компонентов, которые рисуются в браузере (шкалы, подсказки и оси графиков).
 *
 * Как и с датами (lib/date-format), в Chrome нет данных Intl для таджикского:
 * `Intl.NumberFormat("tg")` даёт английское «1,234.5», а Node — таджикское «1 234,5». Для tg число
 * форматирует Intl с en-US (он есть в любом браузере), а разделители заменяются на таджикские:
 * группы — неразрывный пробел, дробная часть — запятая. Остальное у tg и en-US совпадает
 * (минус, проценты «12%», группы по три цифры с тысяч) — сверка с Node в тестах.
 */
export interface NumberFormatOptions {
  style?: "decimal" | "percent";
  minimumIntegerDigits?: number;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  useGrouping?: boolean;
  signDisplay?: "auto" | "always" | "exceptZero" | "never";
}

export interface NumberFormatter {
  format(value: number): string;
}

const TG_GROUP = " ";
const TG_DECIMAL = ",";

/** Форматтер чисел: для tg — без данных Intl этого языка, для остальных — Intl.NumberFormat. */
export function numberFormatter(
  locale: string,
  options: NumberFormatOptions = {},
): NumberFormatter {
  if (!isTajik(locale)) return new Intl.NumberFormat(locale, options);
  const fmt = new Intl.NumberFormat("en-US", options);
  return {
    format: (value) =>
      fmt
        .formatToParts(value)
        .map((part) =>
          part.type === "group" ? TG_GROUP : part.type === "decimal" ? TG_DECIMAL : part.value,
        )
        .join(""),
  };
}
