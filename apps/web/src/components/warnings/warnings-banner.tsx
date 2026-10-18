import type { Locale } from "@meteo/i18n";
import { Alert, AlertDescription, AlertTitle } from "@meteo/ui/components/alert";
import { cn } from "@meteo/ui/lib/utils";
import { SirenIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { name } from "@/lib/format";
import { type LocalizedWarning, loadLocalizedWarnings } from "@/lib/warnings";
import { SeverityDot } from "./severity-badge";

const LEVEL_CLASS: Record<0 | 2 | 3 | 4, string> = {
  0: "border-aq-0/50 bg-aq-0/10",
  2: "border-aq-2/60 bg-aq-2/10",
  3: "border-aq-3/60 bg-aq-3/10",
  4: "border-aq-4/60 bg-aq-4/10",
};

/** Баннер действующих CAP‑предупреждений (главная): до трёх заголовков и ссылка на раздел. */
export async function WarningsBanner({
  locale,
  warnings,
}: {
  locale: Locale;
  warnings?: LocalizedWarning[];
}) {
  const list = (warnings ?? (await loadLocalizedWarnings(locale).catch(() => []))).filter(
    (w) => w.active,
  );
  if (list.length === 0) return null;
  const t = await getTranslations("warnings");
  const top = list[0];
  const level = top?.style.level ?? 0;
  return (
    <Alert className={cn(LEVEL_CLASS[level], "text-foreground")}>
      <SirenIcon />
      <AlertTitle>
        <Link href="/warnings" className="font-semibold">
          {t("bannerTitle", { count: list.length })}
        </Link>
      </AlertTitle>
      <AlertDescription className="text-foreground/90">
        <ul className="grid gap-1">
          {list.slice(0, 3).map((w) => (
            <li key={w.id} className="flex items-center gap-2">
              <SeverityDot severity={w.severity} />
              <Link href="/warnings" className="font-medium underline-offset-4 hover:underline">
                {w.headline}
              </Link>
              {w.regions.length ? (
                <span className="text-muted-foreground">
                  · {w.regions.map((r) => name(r.name, locale) || r.code).join(", ")}
                </span>
              ) : null}
            </li>
          ))}
          {list.length > 3 ? (
            <li>
              <Link
                href="/warnings"
                className="text-muted-foreground underline-offset-4 hover:underline"
              >
                {t("more", { count: list.length - 3 })}
              </Link>
            </li>
          ) : null}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
