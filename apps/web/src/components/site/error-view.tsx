"use client";

import { Button } from "@meteo/ui/components/button";
import { TriangleAlertIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * Страница ошибки (error.tsx): сбой БД или источника не должен показывать английскую заглушку
 * Next.js. Подробности в браузер не попадают — только digest, по нему ищется запись в логах сервера.
 */
export function ErrorView({
  error,
  retry,
  standalone = false,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  /** Без шапки сайта (ошибка вне публичного лейаута): занимает весь экран и сам является <main>. */
  standalone?: boolean;
}) {
  const t = useTranslations("errorPage");
  const Tag = standalone ? "main" : "div";
  return (
    <Tag
      role="alert"
      className={`container-page flex flex-col items-center justify-center gap-4 py-24 text-center ${standalone ? "min-h-dvh" : "min-h-[60dvh]"}`}
    >
      <TriangleAlertIcon className="size-12 text-status-stale" aria-hidden="true" />
      <h1 className="text-h2">{t("title")}</h1>
      <p className="max-w-md text-muted-foreground">{t("description")}</p>
      <div className="flex flex-wrap justify-center gap-3">
        <Button onClick={() => retry()}>{t("retry")}</Button>
        <Button variant="outline" render={<Link href="/" />} nativeButton={false}>
          {t("backHome")}
        </Button>
      </div>
      {error.digest ? (
        <p className="num text-xs text-muted-foreground">{t("code", { digest: error.digest })}</p>
      ) : null}
    </Tag>
  );
}
