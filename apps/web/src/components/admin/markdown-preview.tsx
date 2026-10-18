"use client";

import { renderMarkdown } from "@meteo/core";
import { cn } from "@meteo/ui/lib/utils";
import { useMemo } from "react";
import { PROSE_CLASS } from "@/components/news/prose";

/** Живой предпросмотр Markdown в формах админки. */
export function MarkdownPreview({ markdown, className }: { markdown: string; className?: string }) {
  const html = useMemo(() => renderMarkdown(markdown), [markdown]);
  return (
    <div
      className={cn(PROSE_CLASS, "min-h-40 rounded-lg border bg-background p-4", className)}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML генерирует наш Markdown‑рендерер с экранированием
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
