import { notFound } from "next/navigation";

// CSP с nonce требует динамического рендера (docs/security-checklist.md).
export const dynamic = "force-dynamic";

/** Любой неизвестный маршрут внутри локали → локализованная страница 404. */
export default function CatchAll() {
  notFound();
}
