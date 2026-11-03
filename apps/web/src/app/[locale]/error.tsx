"use client";

import { ErrorView } from "@/components/site/error-view";

/** Ошибка вне публичного лейаута (сам лейаут с шапкой, админка, виджеты): сообщение на весь экран. */
export default function LocaleError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorView error={error} retry={retry} standalone />;
}
