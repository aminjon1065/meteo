"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";

export interface DeferUntilVisibleProps {
  children: ReactNode;
  /** Что показывать до появления в зоне видимости (скелет той же высоты). */
  placeholder?: ReactNode;
  /** Запас до viewport, с которого начинается загрузка. */
  rootMargin?: string;
  className?: string;
  /** Метка для тестов: data-deferred="<name>". */
  name?: string;
}

/**
 * Откладывает монтирование тяжёлого клиентского блока (MapLibre, ECharts) до того, как его
 * контейнер приблизится к области просмотра: на медленных сетях текст страницы и шрифты не
 * конкурируют за канал с чанками карты, глифами подложки и тайлами (docs/perf.md).
 * Без IntersectionObserver (очень старые браузеры) блок монтируется сразу.
 */
export function DeferUntilVisible({
  children,
  placeholder = null,
  rootMargin = "320px",
  className,
  name,
}: DeferUntilVisibleProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || visible) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin, visible]);

  return (
    <div
      ref={ref}
      className={className}
      data-deferred={visible ? `${name ?? "block"}:loaded` : (name ?? "block")}
    >
      {visible ? children : placeholder}
    </div>
  );
}
