import { cn } from "@meteo/ui/lib/utils";

/**
 * Эмблема Агентства по гидрометеорологии: круглая, фон прозрачный (одинаково в светлой и тёмной теме).
 * Файлы — public/brand/hydromet-emblem-{96,192,384}.webp (из исходника 2000×2000, 23.10.2026); иконки
 * вкладки — app/favicon.ico, app/icon.png, app/apple-icon.png. Декоративна: название сайта или
 * Агентства всегда рядом текстом или в aria-label ссылки.
 */
export function Logo({ className }: { className?: string }) {
  return (
    // Статичный маленький файл с srcset: оптимизатор next/image здесь не нужен.
    // biome-ignore lint/performance/noImgElement: см. комментарий выше
    <img
      src="/brand/hydromet-emblem-96.webp"
      srcSet="/brand/hydromet-emblem-96.webp 96w, /brand/hydromet-emblem-192.webp 192w, /brand/hydromet-emblem-384.webp 384w"
      sizes="64px"
      width={96}
      height={96}
      alt=""
      aria-hidden="true"
      decoding="async"
      className={cn("size-8 shrink-0 select-none", className)}
    />
  );
}
