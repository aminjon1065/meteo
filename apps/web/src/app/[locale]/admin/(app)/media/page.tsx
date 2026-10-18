import { desc } from "@meteo/db";
import { media } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MediaGrid } from "@/components/admin/media/media-grid";
import { MediaUploader } from "@/components/admin/media/media-uploader";
import { getDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session";
import { uploadUrl } from "@/lib/uploads";
import { deleteMedia } from "./actions";

export const dynamic = "force-dynamic";

export default async function MediaPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdminSession(locale, "content.write");
  const [t, rows] = await Promise.all([
    getTranslations("media"),
    getDb().select().from(media).orderBy(desc(media.createdAt)).limit(300),
  ]);

  async function remove(id: number) {
    "use server";
    return deleteMedia(locale, id);
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="max-w-3xl text-muted-foreground">{t("subtitle")}</p>
        </div>
        <MediaUploader />
      </div>
      <MediaGrid
        items={rows.map((m) => ({
          id: m.id,
          url: uploadUrl(m.path),
          originalName: m.originalName,
          mime: m.mime,
          size: m.size,
          width: m.width,
          height: m.height,
          createdAt: m.createdAt.toISOString(),
        }))}
        remove={remove}
      />
    </>
  );
}
