"use client";

import { Button } from "@meteo/ui/components/button";
import { useTransition } from "react";
import { toast } from "sonner";
import type { RuleResult } from "@/app/[locale]/admin/(app)/alerts/actions";
import { useRouter } from "@/i18n/navigation";

export function ResolveEventButton({
  id,
  resolve,
  label,
}: {
  id: number;
  resolve: (id: number) => Promise<RuleResult>;
  label: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const r = await resolve(id);
          if (r.ok) router.refresh();
          else toast.error(r.message);
        })
      }
    >
      {label}
    </Button>
  );
}
