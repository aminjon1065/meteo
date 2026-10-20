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
import { Checkbox } from "@meteo/ui/components/checkbox";
import { Field, FieldDescription, FieldLabel } from "@meteo/ui/components/field";
import { Input } from "@meteo/ui/components/input";
import { Spinner } from "@meteo/ui/components/spinner";
import { RefreshCwIcon, SendIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { toast } from "sonner";
import type { EcoBulletinResult } from "@/app/[locale]/admin/(app)/eco-bulletins/actions";
import { useRouter } from "@/i18n/navigation";
import { translateOr } from "@/lib/i18n-utils";

export interface EcoBulletinActionsProps {
  id: number;
  date: string;
  status: "draft" | "published";
  gamma: string | null;
  subscribers: number;
  canWrite: boolean;
  canPublish: boolean;
  saveGamma: (raw: unknown) => Promise<EcoBulletinResult>;
  recompute: () => Promise<EcoBulletinResult>;
  publish: (raw: unknown) => Promise<EcoBulletinResult>;
  remove: () => Promise<EcoBulletinResult>;
}

/** Действия над черновиком: гамма‑фон, пересчёт, публикация (с рассылкой), удаление. */
export function EcoBulletinActions(props: EcoBulletinActionsProps) {
  const t = useTranslations("ecoBulletin");
  const tc = useTranslations("common");
  const router = useRouter();
  const [gamma, setGamma] = useState(props.gamma ?? "");
  const [mail, setMail] = useState(false);
  const [pending, startTransition] = useTransition();
  const fail = (r: Extract<EcoBulletinResult, { ok: false }>): void => {
    toast.error(translateOr(t, `errors.${r.message}`, r.message));
  };

  if (props.status !== "draft") return null;

  function onGamma(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const r = await props.saveGamma({ gamma });
      if (!r.ok) return fail(r);
      toast.success(t("gammaSaved"));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {props.canWrite ? (
        <form onSubmit={onGamma} className="flex flex-col gap-2" noValidate>
          <Field>
            <FieldLabel htmlFor="gamma">{t("fields.gamma")}</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="gamma"
                value={gamma}
                onChange={(e) => setGamma(e.target.value)}
                placeholder="0,014"
                maxLength={32}
              />
              <Button type="submit" variant="outline" disabled={pending}>
                {t("saveGamma")}
              </Button>
            </div>
            <FieldDescription>{t("fields.gammaHint")}</FieldDescription>
          </Field>
        </form>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {props.canWrite ? (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await props.recompute();
                if (!r.ok) return fail(r);
                toast.success(t("recomputed"));
                router.refresh();
              })
            }
          >
            <RefreshCwIcon aria-hidden="true" />
            {t("regenerate")}
          </Button>
        ) : null}
        {props.canPublish ? (
          <AlertDialog>
            <AlertDialogTrigger render={<Button disabled={pending} />}>
              {pending ? <Spinner /> : <SendIcon aria-hidden="true" />}
              {t("publish")}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("publishTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("publishConfirm")}</AlertDialogDescription>
              </AlertDialogHeader>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="publish-mail"
                  checked={mail}
                  disabled={props.subscribers === 0}
                  onCheckedChange={(c) => setMail(Boolean(c))}
                />
                <label htmlFor="publish-mail" className="text-sm">
                  {t("publishMail", { count: props.subscribers })}
                </label>
              </div>
              <AlertDialogFooter>
                <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    startTransition(async () => {
                      const r = await props.publish({ mail });
                      if (!r.ok) return fail(r);
                      toast.success(
                        r.recipients
                          ? t("publishedWithMail", { count: r.recipients })
                          : t("published"),
                      );
                      router.refresh();
                    })
                  }
                >
                  {t("publish")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
        {props.canWrite ? (
          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="ghost" className="text-destructive" disabled={pending} />}
            >
              <Trash2Icon aria-hidden="true" />
              {t("delete")}
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("delete")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("deleteConfirm", { date: props.date })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    startTransition(async () => {
                      const r = await props.remove();
                      if (!r.ok) return fail(r);
                      router.push("/admin/eco-bulletins");
                      router.refresh();
                    })
                  }
                >
                  {t("delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : null}
      </div>
    </div>
  );
}
