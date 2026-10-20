import { getEcoBulletinSettings, getPublishedEcoBulletin } from "@meteo/db";
import { type NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  downloadName,
  ECO_MIME,
  ecoDocument,
  parseEcoFileName,
  readEcoFile,
  renderEcoFile,
} from "@/lib/eco-bulletin";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/eco-bulletins/{id}/{kind}-{lang}.{docx|pdf|html} — документы опубликованного
 * бюллетеня: DOCX/PDF из сохранённых при публикации файлов, HTML рендерится из данных.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; file: string }> },
) {
  const { id: rawId, file } = await ctx.params;
  const id = Number(rawId);
  const spec = parseEcoFileName(file);
  if (!Number.isInteger(id) || !spec)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  const db = getDb();
  const row = await getPublishedEcoBulletin(db, id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const settings = await getEcoBulletinSettings(db);
  const doc = ecoDocument(row, settings, spec.kind, spec.lang);
  let bytes = readEcoFile(id, file);
  if (!bytes && spec.ext !== "pdf") bytes = await renderEcoFile(doc, spec.ext);
  if (!bytes) return NextResponse.json({ error: "not found" }, { status: 404 });
  const inline = spec.ext === "html";
  return new NextResponse(bytes as BodyInit, {
    headers: {
      "Content-Type": ECO_MIME[spec.ext],
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${downloadName(doc, spec.ext)}"`,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      ...(inline
        ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" }
        : {}),
    },
  });
}
