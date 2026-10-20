import { type DocModel, ECO_DOC_CSS, renderDocHtml } from "@meteo/core";
import { cn } from "@meteo/ui/lib/utils";

/** Предпросмотр документа бюллетеня: HTML собирает рендерер @meteo/core с экранированием текста. */
export function EcoDocPreview({ doc, className }: { doc: DocModel; className?: string }) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-xl border bg-white p-6 text-black shadow-sm sm:p-10",
        className,
      )}
      data-testid="eco-doc-preview"
    >
      <style>{ECO_DOC_CSS}</style>
      <div
        // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML генерирует наш рендерер документа, весь текст экранируется
        dangerouslySetInnerHTML={{ __html: renderDocHtml(doc) }}
      />
    </div>
  );
}
