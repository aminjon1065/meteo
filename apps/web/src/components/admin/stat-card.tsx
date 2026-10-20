import { cn } from "@meteo/ui/lib/utils";
import type { LucideIcon } from "lucide-react";

/** Компактный показатель дашборда: подпись и число в одну плитку без карточной рамки. */
export function StatCard({
  icon: Icon,
  label,
  value,
  href,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  href?: string;
  className?: string;
}) {
  const Tag = href ? "a" : "div";
  return (
    <Tag
      href={href}
      className={cn(
        "grid min-w-0 content-start gap-1 rounded-xl border bg-card px-3.5 py-3",
        href && "transition-colors hover:border-foreground/25",
        className,
      )}
    >
      <span className="flex items-center gap-1.5 text-caption text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        <span className="line-clamp-2 leading-tight">{label}</span>
      </span>
      <span className="num font-heading text-2xl leading-none font-bold">{value}</span>
    </Tag>
  );
}
