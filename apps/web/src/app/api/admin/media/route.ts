import { can, detectFileType, MAX_UPLOAD_BYTES } from "@meteo/core";
import { media } from "@meteo/db/schema";
import { NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";
import { storeUpload, uploadUrl } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/media (multipart, поле file) — загрузка изображения или PDF в UPLOADS_DIR.
 * Тип определяется по содержимому (сигнатуры), а не по заголовку клиента; лимит 10 МБ.
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(session.user.role, "content.write"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "size" }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectFileType(bytes);
  if (!type) return NextResponse.json({ error: "type" }, { status: 415 });
  const rel = await storeUpload(bytes, type.ext);
  const [row] = await getDb()
    .insert(media)
    .values({
      path: rel,
      originalName: file.name.slice(0, 255),
      mime: type.mime,
      size: bytes.length,
      width: type.width,
      height: type.height,
      alt: {},
      uploadedBy: session.user.id,
    })
    .returning({ id: media.id });
  if (!row) return NextResponse.json({ error: "insert" }, { status: 500 });
  await recordAudit(session, {
    action: "media.upload",
    entity: "media",
    entityId: row.id,
    after: { path: rel, mime: type.mime, size: bytes.length, name: file.name },
  });
  return NextResponse.json({
    id: row.id,
    path: rel,
    url: uploadUrl(rel),
    mime: type.mime,
    width: type.width,
    height: type.height,
    size: bytes.length,
  });
}
