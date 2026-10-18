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
import { SendIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import type { BulletinResult } from "@/app/[locale]/admin/(app)/bulletins/actions";
import { useRouter } from "@/i18n/navigation";
import { translateOr } from "@/lib/i18n-utils";

/** Отправка бюллетеня подписчикам (с подтверждением и числом получателей) и удаление черновика. */
export function BulletinActions({
  recipients,
  canSend,
  send,
  remove,
}: {
  recipients: number;
  canSend: boolean;
  send: () => Promise<BulletinResult>;
  remove: () => Promise<BulletinResult>;
}) {
  const t = useTranslations("bulletins");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap gap-2">
      {canSend ? (
        <AlertDialog>
          <AlertDialogTrigger render={<Button disabled={pending || recipients === 0} />}>
            <SendIcon aria-hidden="true" />
            {t("send")}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("sendTitle")}</AlertDialogTitle>
              <AlertDialogDescription>
                {t("sendConfirm", { count: recipients })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  startTransition(async () => {
                    const r = await send();
                    if (!r.ok) {
                      toast.error(translateOr(t, `errors.${r.message}`, r.message));
                      return;
                    }
                    toast.success(t("queued", { count: r.recipients ?? 0 }));
                    router.refresh();
                  })
                }
              >
                {t("send")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
      {recipients === 0 ? (
        <span className="self-center text-sm text-muted-foreground">{t("noRecipients")}</span>
      ) : null}
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
            <AlertDialogDescription>{t("deleteConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tc("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                startTransition(async () => {
                  const r = await remove();
                  if (!r.ok) {
                    toast.error(translateOr(t, `errors.${r.message}`, r.message));
                    return;
                  }
                  router.push("/admin/bulletins");
                  router.refresh();
                })
              }
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
