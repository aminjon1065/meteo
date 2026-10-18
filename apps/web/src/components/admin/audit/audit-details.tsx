"use client";

import { Button } from "@meteo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@meteo/ui/components/dialog";

export function AuditDetails({
  before,
  after,
  userAgent,
  label,
  beforeLabel,
  afterLabel,
}: {
  before: unknown;
  after: unknown;
  userAgent: string | null;
  label: string;
  beforeLabel: string;
  afterLabel: string;
}) {
  if (before === null && after === null) return <span className="text-muted-foreground">—</span>;
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>{label}</DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          {userAgent ? (
            <DialogDescription className="truncate font-mono text-xs">
              {userAgent}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground uppercase">
              {beforeLabel}
            </p>
            <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs">
              {before === null ? "—" : JSON.stringify(before, null, 2)}
            </pre>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground uppercase">{afterLabel}</p>
            <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/40 p-3 text-xs">
              {after === null ? "—" : JSON.stringify(after, null, 2)}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
