import { cn } from "@meteo/ui/lib/utils";

const FMI_URL = "https://en.ilmatieteenlaitos.fi/";

/**
 * Высота логотипа и поле вокруг — 1/4 высоты знака (знак занимает всю высоту горизонтальной версии).
 * Ширина — по пропорции viewBox 177,5 × 32,5. Классы целиком (Tailwind не видит собранные строки).
 */
const SIZES = {
  sm: {
    img: "h-11 w-[241px]",
    plate: "p-[11px]",
    darkPlate: "dark:p-[11px]",
    width: 241,
    height: 44,
  },
  md: { img: "h-14 w-[306px]", plate: "p-3.5", darkPlate: "dark:p-3.5", width: 306, height: 56 },
} as const;

/**
 * Логотип Финского метеорологического института — основная горизонтальная трёхъязычная версия
 * (Ilmatieteen laitos / Meteorologiska institutet / Finnish Meteorological Institute). Вектор взят из
 * FMI Graphic Guidelines 3/2025 (последняя страница), файл public/brand/fmi-logo.svg — синий #303193.
 * Правила FMI: синий — только на белом фоне, на цветном — белый и только на цветах FMI; поле вокруг —
 * 1/4 высоты знака; логотип не изменять и не совмещать с другими элементами. Поэтому в светлой теме —
 * синий на белом (без подложки, где фон уже белый, — `onWhite`; иначе белая карточка), в тёмной — белый
 * (тот же файл через brightness-0 + invert) на основном синем FMI.
 */
export function FmiLogo({
  alt,
  size = "sm",
  onWhite = false,
  className,
}: {
  /** Название института на языке страницы (текст ссылки для скринридеров). */
  alt: string;
  size?: keyof typeof SIZES;
  /** Фон под логотипом уже белый (#fff, например bg-card): в светлой теме подложка не нужна. */
  onWhite?: boolean;
  className?: string;
}) {
  const s = SIZES[size];
  return (
    <a
      href={FMI_URL}
      rel="noopener"
      className={cn(
        "block w-fit max-w-full shrink-0 rounded-lg dark:bg-[#303193] focus-visible:outline-2 focus-visible:outline-offset-2",
        onWhite ? s.darkPlate : cn(s.plate, "border bg-white dark:border-transparent"),
        className,
      )}
    >
      {/* Статичный SVG кэшируется браузером на всех страницах; оптимизатор next/image не нужен. */}
      {/* biome-ignore lint/performance/noImgElement: см. комментарий выше */}
      <img
        src="/brand/fmi-logo.svg"
        width={s.width}
        height={s.height}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={cn(
          "block max-w-full select-none object-contain object-left dark:brightness-0 dark:invert",
          s.img,
        )}
      />
    </a>
  );
}
