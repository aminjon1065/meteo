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
import { CopyIcon, FileIcon, Trash2Icon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useTransition } from "react";
import { toast } from "sonner";
import type { MediaResult } from "@/app/[locale]/admin/(app)/media/actions";
import { useRouter } from "@/i18n/navigation";

export interface MediaItem {
  id: number;
  url: string;
  originalName: string | null;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  createdAt: string;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 104857.6) / 10} MB`;
}

/** Сетка медиафайлов: превью, ссылка для Markdown, удаление с подтверждением. */
export function MediaGrid({
  items,
  remove,
}: {
  items: MediaItem[];
  remove: (id: number) => Promise<MediaResult>;
}) {
  const t = useTranslations("media");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${url}`);
      toast.success(t("copied"));
    } catch {
      toast.error(url);
    }
  }

  if (items.length === 0) {
    return (
      <p className="rounded-xl border bg-card p-6 text-center text-muted-foreground">
        {t("empty")}
      </p>
    );
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((m) => (
        <li key={m.id} className="flex flex-col overflow-hidden rounded-xl border bg-card">
          {m.mime.startsWith("image/") ? (
            // biome-ignore lint/performance/noImgElement: превью файла из нашего каталога загрузок
            <img
              src={m.url}
              alt={m.originalName ?? ""}
              className="aspect-video w-full object-cover"
            />
          ) : (
            <div className="flex aspect-video items-center justify-center text-muted-foreground">
              <FileIcon className="size-10" aria-hidden="true" />
            </div>
          )}
          <div className="flex flex-col gap-1 p-3 text-xs">
            <p className="truncate font-medium" title={m.originalName ?? m.url}>
              {m.originalName ?? m.url}
            </p>
            <p className="text-muted-foreground">
              {m.mime} · {formatSize(m.size)}
              {m.width && m.height ? ` · ${m.width}×${m.height}` : ""}
            </p>
            <p className="text-muted-foreground">
              {format.dateTime(new Date(m.createdAt), { dateStyle: "medium" })}
            </p>
            <div className="mt-1 flex items-center gap-1">
              <Button type="button" size="sm" variant="outline" onClick={() => copy(m.url)}>
                <CopyIcon aria-hidden="true" />
                {t("copyUrl")}
              </Button>
              <AlertDialog>
                <AlertDialogTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("delete")}
                      disabled={pending}
                    />
                  }
                >
                  <Trash2Icon />
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
                          const r = await remove(m.id);
                          if (!r.ok) toast.error(r.message);
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
          </div>
        </li>
      ))}
    </ul>
  );
}
