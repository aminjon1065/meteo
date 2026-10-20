import { cn } from "@meteo/ui/lib/utils";
import type { ReactNode } from "react";

/** Заголовок раздела: h1 по типографической шкале, короткое введение, действия справа. */
export function PageHeader({
  title,
  intro,
  children,
  actions,
  className,
}: {
  title: ReactNode;
  intro?: ReactNode;
  /** Дополнительная строка под введением (легенда, ссылки). */
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <h1 className="text-h1">{title}</h1>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {intro ? <p className="max-w-3xl text-pretty text-muted-foreground">{intro}</p> : null}
      {children}
    </header>
  );
}

/** Секция страницы с заголовком и необязательной ссылкой справа. */
export function Section({
  title,
  aside,
  id,
  children,
  className,
  level = 2,
}: {
  title: ReactNode;
  aside?: ReactNode;
  id?: string;
  children: ReactNode;
  className?: string;
  level?: 2 | 3;
}) {
  const Heading = level === 3 ? "h3" : "h2";
  return (
    <section className={className} aria-labelledby={id}>
      <div className="section-head">
        <Heading id={id} className={level === 3 ? "text-h3" : "text-h2"}>
          {title}
        </Heading>
        {aside ? <div className="text-sm text-muted-foreground">{aside}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** Ссылка «Все … →» в заголовке секции. */
export function MoreLink({ children }: { children: ReactNode }) {
  return <span className="text-sm font-semibold text-brand">{children}</span>;
}
