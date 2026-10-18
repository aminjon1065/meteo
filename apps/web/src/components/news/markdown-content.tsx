import { renderMarkdown } from "@meteo/core";
import { cn } from "@meteo/ui/lib/utils";
import { PROSE_CLASS } from "./prose";

/** Текст новости/бюллетеня из Markdown. HTML собирает собственный рендерер с экранированием. */
export function MarkdownContent({
  markdown,
  className,
  lang,
}: {
  markdown: string;
  className?: string;
  lang?: string;
}) {
  return (
    <div
      className={cn(PROSE_CLASS, className)}
      lang={lang}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML генерирует наш Markdown‑рендерер, весь текст экранируется, схемы ссылок — по белому списку
      dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
    />
  );
}
