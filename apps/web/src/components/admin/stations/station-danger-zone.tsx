"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@meteo/ui/components/alert-dialog";
import { Button } from "@meteo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { Field, FieldLabel } from "@meteo/ui/components/field";
import { Input } from "@meteo/ui/components/input";
import { CopyIcon, KeyRoundIcon, PowerOffIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { StationActionResult } from "@/app/[locale]/admin/(app)/stations/actions";
import { useRouter } from "@/i18n/navigation";

export interface StationDangerZoneProps {
  status: string;
  hasApiKey: boolean;
  decommission: (date: string) => Promise<StationActionResult>;
  rotateKey: () => Promise<{ ok: true; apiKey: string } | { ok: false; message: string }>;
}

export function StationDangerZone({
  status,
  hasApiKey,
  decommission,
  rotateKey,
}: StationDangerZoneProps) {
  const t = useTranslations("stations");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [apiKey, setApiKey] = useState<string | null>(null);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRoundIcon className="size-4" aria-hidden="true" />
            {t("apiKey.title")}
          </CardTitle>
          <CardDescription>
            {hasApiKey || apiKey ? t("apiKey.exists") : t("apiKey.none")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {apiKey ? (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-2 font-mono text-xs break-all">
              <span className="flex-1">{apiKey}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="copy"
                onClick={async () => {
                  await navigator.clipboard.writeText(apiKey);
                  toast.success(t("apiKey.copied"));
                }}
              >
                <CopyIcon />
              </Button>
            </div>
          ) : null}
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await rotateKey();
                if (result.ok) {
                  setApiKey(result.apiKey);
                  toast.success(t("apiKey.rotated"));
                } else {
                  toast.error(result.message);
                }
              })
            }
          >
            {hasApiKey || apiKey ? t("apiKey.rotate") : t("apiKey.generate")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("apiKey.hint")}</p>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PowerOffIcon className="size-4" aria-hidden="true" />
            {t("decommission.title")}
          </CardTitle>
          <CardDescription>{t("decommission.hint")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="decommission-date">{t("fields.decommissionedAt")}</FieldLabel>
            <Input
              id="decommission-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={status === "decommissioned"}
            />
          </Field>
          <AlertDialog>
            <AlertDialogTrigger
              render={
                <Button variant="destructive" disabled={status === "decommissioned" || pending} />
              }
            >
              {t("decommission.action")}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("decommission.confirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("decommission.confirmText", { date })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    startTransition(async () => {
                      const result = await decommission(date);
                      if (result.ok) {
                        toast.success(t("decommission.done"));
                        router.refresh();
                      } else {
                        toast.error(result.message);
                      }
                    })
                  }
                >
                  {t("decommission.action")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
