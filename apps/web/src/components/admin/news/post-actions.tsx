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
import { Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import type { NewsResult } from "@/app/[locale]/admin/(app)/news/actions";
import { useRouter } from "@/i18n/navigation";
import { translateOr } from "@/lib/i18n-utils";
import type { NewsStatus } from "@/lib/validation/news";

/** Публикация, снятие с публикации и удаление новости (с подтверждением). */
export function PostActions({
  status,
  canPublish,
  setStatus,
  remove,
}: {
  status: NewsStatus;
  canPublish: boolean;
  setStatus: (status: NewsStatus) => Promise<NewsResult>;
  remove: () => Promise<NewsResult>;
}) {
  const t = useTranslations("newsAdmin");
  const tc = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<NewsResult>, after?: () => void) {
    startTransition(async () => {
      const r = await fn();
      if (!r.ok) {
        toast.error(translateOr(t, `errors.${r.message}`, r.message));
        return;
      }
      toast.success(t("saved"));
      after ? after() : router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canPublish && status !== "published" ? (
        <Button disabled={pending} onClick={() => run(() => setStatus("published"))}>
          {t("publish")}
        </Button>
      ) : null}
      {status === "published" ? (
        <Button variant="outline" disabled={pending} onClick={() => run(() => setStatus("draft"))}>
          {t("unpublish")}
        </Button>
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
                run(remove, () => {
                  router.push("/admin/news");
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
