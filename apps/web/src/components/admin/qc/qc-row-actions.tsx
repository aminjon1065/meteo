"use client";

import { Button } from "@meteo/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@meteo/ui/components/dialog";
import { Field, FieldLabel } from "@meteo/ui/components/field";
import { Input } from "@meteo/ui/components/input";
import { Spinner } from "@meteo/ui/components/spinner";
import { CheckIcon, PencilIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { QcDecisionResult } from "@/app/[locale]/admin/(app)/measurements/qc/actions";
import { useRouter } from "@/i18n/navigation";
import { translateOr } from "@/lib/i18n-utils";

export interface QcRowActionsProps {
  rowKey: { time: string; stationId: number; pollutantId: number; averagingMin: number };
  value: number | null;
  unit: string;
  resolve: (key: unknown, decision: unknown) => Promise<QcDecisionResult>;
}

export function QcRowActions({ rowKey, value, unit, resolve }: QcRowActionsProps) {
  const t = useTranslations("qc");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState<"correct" | "reject" | null>(null);
  const [newValue, setNewValue] = useState(value !== null ? String(value) : "");
  const [reason, setReason] = useState("");

  function run(decision: Record<string, unknown>) {
    startTransition(async () => {
      const result = await resolve(rowKey, decision);
      if (!result.ok) {
        toast.error(translateOr(t, `errors.${result.message}`, result.message));
        return;
      }
      toast.success(t("done"));
      setOpen(null);
      setReason("");
      router.refresh();
    });
  }

  return (
    <div className="flex justify-end gap-1">
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => run({ decision: "confirm" })}
        title={t("confirm")}
      >
        <CheckIcon aria-hidden="true" />
        {t("confirm")}
      </Button>
      <Dialog open={open === "correct"} onOpenChange={(o) => setOpen(o ? "correct" : null)}>
        <DialogTrigger render={<Button variant="ghost" size="sm" disabled={pending} />}>
          <PencilIcon aria-hidden="true" />
          {t("correct")}
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("correctTitle")}</DialogTitle>
            <DialogDescription>{t("correctHint")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field>
              <FieldLabel htmlFor="qc-value">
                {t("newValue")} ({unit})
              </FieldLabel>
              <Input
                id="qc-value"
                inputMode="decimal"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="qc-reason">{t("reasonLabel")}</FieldLabel>
              <Input
                id="qc-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("reasonPlaceholder")}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>
              {t("cancel")}
            </Button>
            <Button
              disabled={pending || reason.trim().length < 2}
              onClick={() => run({ decision: "correct", value: newValue, reason })}
            >
              {pending ? <Spinner /> : null}
              {t("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={open === "reject"} onOpenChange={(o) => setOpen(o ? "reject" : null)}>
        <DialogTrigger
          render={
            <Button variant="ghost" size="sm" disabled={pending} className="text-destructive" />
          }
        >
          <XIcon aria-hidden="true" />
          {t("reject")}
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("rejectTitle")}</DialogTitle>
            <DialogDescription>{t("rejectHint")}</DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="qc-reject-reason">{t("reasonLabel")}</FieldLabel>
            <Input
              id="qc-reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("reasonPlaceholder")}
            />
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>
              {t("cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={pending || reason.trim().length < 2}
              onClick={() => run({ decision: "reject", reason })}
            >
              {pending ? <Spinner /> : null}
              {t("reject")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
