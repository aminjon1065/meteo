"use client";

import { ErrorView } from "@/components/site/error-view";

/** Ошибка страницы публичного раздела: шапка и меню остаются, вместо содержимого — сообщение. */
export default function PublicError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorView error={error} retry={retry} />;
}
