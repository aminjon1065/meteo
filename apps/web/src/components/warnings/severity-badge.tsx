import { severityStyle } from "@meteo/core";
import { cn } from "@meteo/ui/lib/utils";

const BADGE: Record<0 | 2 | 3 | 4, string> = {
  0: "bg-aq-0 text-aq-0-foreground",
  2: "bg-aq-2 text-aq-2-foreground",
  3: "bg-aq-3 text-aq-3-foreground",
  4: "bg-aq-4 text-aq-4-foreground",
};

const BORDER: Record<0 | 2 | 3 | 4, string> = {
  0: "border-l-aq-0",
  2: "border-l-aq-2",
  3: "border-l-aq-3",
  4: "border-l-aq-4",
};

const DOT: Record<0 | 2 | 3 | 4, string> = {
  0: "bg-aq-0",
  2: "bg-aq-2",
  3: "bg-aq-3",
  4: "bg-aq-4",
};

/** Цветная плашка уровня опасности CAP (жёлтый / оранжевый / красный). */
export function SeverityBadge({
  severity,
  label,
  className,
}: {
  severity: string;
  label: string;
  className?: string;
}) {
  const style = severityStyle(severity);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        BADGE[style.level],
        className,
      )}
    >
      {label}
    </span>
  );
}

export function SeverityDot({ severity, className }: { severity: string; className?: string }) {
  const style = severityStyle(severity);
  return (
    <span
      className={cn("inline-block size-3 shrink-0 rounded-full", DOT[style.level], className)}
      aria-hidden="true"
    />
  );
}

export function severityBorderClass(severity: string): string {
  return BORDER[severityStyle(severity).level];
}
