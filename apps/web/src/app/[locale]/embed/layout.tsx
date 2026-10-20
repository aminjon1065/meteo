import type { Metadata } from "next";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Встраиваемые виджеты (iframe на meteo.tj): без шапки и подвала, компактные отступы. */
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-background p-2 text-sm text-foreground">{children}</div>;
}
