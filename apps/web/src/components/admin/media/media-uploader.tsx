"use client";

import { Button } from "@meteo/ui/components/button";
import { Spinner } from "@meteo/ui/components/spinner";
import { UploadIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { translateOr } from "@/lib/i18n-utils";

/** Загрузка файла через POST /api/admin/media с проверкой типа по содержимому на сервере. */
export function MediaUploader() {
  const t = useTranslations("media");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/admin/media", { method: "POST", body });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(translateOr(t, `errors.${data.error ?? "upload"}`, t("errors.upload")));
        return;
      }
      toast.success(t("uploaded"));
      router.refresh();
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
        className="sr-only"
        id="media-file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <Button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? <Spinner /> : <UploadIcon aria-hidden="true" />}
        {t("upload")}
      </Button>
    </div>
  );
}
