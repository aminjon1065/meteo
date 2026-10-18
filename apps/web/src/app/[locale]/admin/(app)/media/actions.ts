"use server";

import { eq } from "@meteo/db";
import { media } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session";
import { removeUpload } from "@/lib/uploads";

export type MediaResult = { ok: true } | { ok: false; message: string };

/** Удаляет запись и файл из UPLOADS_DIR; обложки новостей обнуляются каскадом (set null). */
export async function deleteMedia(locale: Locale, id: number): Promise<MediaResult> {
  const session = await requireAdminSession(locale, "content.write");
  const db = getDb();
  const row = await db.query.media.findFirst({ where: eq(media.id, id) });
  if (!row) return { ok: false, message: "notFound" };
  await db.delete(media).where(eq(media.id, id));
  await removeUpload(row.path);
  await recordAudit(session, {
    action: "media.delete",
    entity: "media",
    entityId: id,
    before: { path: row.path, mime: row.mime, size: row.size },
  });
  return { ok: true };
}
