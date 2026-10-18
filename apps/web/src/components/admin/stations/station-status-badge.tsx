import { Badge } from "@meteo/ui/components/badge";
import { cn } from "@meteo/ui/lib/utils";

/** Тонированный фон + затемнённый текст того же оттенка: контраст ≥ 4.5:1 в обеих темах. */
const styles: Record<string, string> = {
  active: "border-status-fresh/30 bg-status-fresh/15 text-status-fresh-text",
  suspended: "border-status-stale/30 bg-status-stale/15 text-status-stale-text",
  decommissioned: "bg-muted text-muted-foreground",
};

export function StationStatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <Badge variant="outline" className={cn("font-medium", styles[status])}>
      {label}
    </Badge>
  );
}
