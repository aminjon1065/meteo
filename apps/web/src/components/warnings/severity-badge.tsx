import { severityStyle } from "@meteo/core";
import { cn } from "@meteo/ui/lib/utils";

/** Уровень CAP → токены уровня воздуха того же цвета: жёлтый (2), оранжевый (3), красный (4). */
const TINT: Record<0 | 2 | 3 | 4, string> = {
  0: "bg-aq-0-tint",
  2: "bg-aq-2-tint",
  3: "bg-aq-3-tint",
  4: "bg-aq-4-tint",
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

/** Плашка уровня опасности CAP: точка цвета + подпись на лёгкой заливке. */
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
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-foreground",
        TINT[style.level],
        className,
      )}
    >
      <span
        className={cn("inline-block size-2 rounded-full", DOT[style.level])}
        aria-hidden="true"
      />
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
