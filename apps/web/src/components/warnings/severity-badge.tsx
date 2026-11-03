import { CAP_SEVERITY_RANK, type CapSeverity, severityStyle } from "@meteo/core";
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

const FG: Record<0 | 2 | 3 | 4, string> = {
  0: "text-aq-0-foreground",
  2: "text-aq-2-foreground",
  3: "text-aq-3-foreground",
  4: "text-aq-4-foreground",
};

/** Цифра уровня опасности: 1 — низкая … 4 — чрезвычайная (CAP_SEVERITY_RANK); неизвестный — «?». */
export function severityNumber(severity: string): string {
  const rank = CAP_SEVERITY_RANK[severity as CapSeverity] ?? 0;
  return rank > 0 ? String(rank) : "?";
}

/**
 * Знак уровня опасности: круг цвета уровня с цифрой 1–4. Цифра различает уровни без цвета
 * (WCAG 1.4.1) — в том числе высокую и чрезвычайную опасность, у которых цвет один (красный).
 * Декоративен: смысл передаёт подпись или aria-label ссылки рядом.
 */
export function SeverityMark({ severity, className }: { severity: string; className?: string }) {
  const style = severityStyle(severity);
  return (
    <span
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] leading-none font-bold tabular-nums",
        DOT[style.level],
        FG[style.level],
        className,
      )}
      aria-hidden="true"
      data-severity={severity}
    >
      {severityNumber(severity)}
    </span>
  );
}

/** Плашка уровня опасности CAP: знак уровня (цвет + цифра) и подпись на лёгкой заливке. */
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
      <SeverityMark severity={severity} className="size-3.5 text-[9px]" />
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
