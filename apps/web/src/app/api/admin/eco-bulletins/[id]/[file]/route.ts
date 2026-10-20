import { getEcoBulletin, getEcoBulletinSettings } from "@meteo/db";
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
import { requireApiSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/eco-bulletins/{id}/{kind}-{lang}.{docx|pdf|html} — документ бюллетеня (черновик
 * рендерится из данных, опубликованный отдаётся из сохранённых файлов). PDF без Chromium на сервере
 * → редирект на печатную HTML‑версию (?print=1 вызывает диалог печати).
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string; file: string }> },
) {
  const auth = await requireApiSession("ecoBulletin.read");
  if (auth.response) return auth.response;
  const { id: rawId, file } = await ctx.params;
  const id = Number(rawId);
  const spec = parseEcoFileName(file);
  if (!Number.isInteger(id) || !spec)
    return NextResponse.json({ error: "not found" }, { status: 404 });
  const db = getDb();
  const row = await getEcoBulletin(db, id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const settings = await getEcoBulletinSettings(db);
  const doc = ecoDocument(row, settings, spec.kind, spec.lang);
  const stored = row.status === "published" ? readEcoFile(id, file) : null;
  const print = req.nextUrl.searchParams.get("print") === "1";
  const bytes = stored ?? (await renderEcoFile(doc, spec.ext, { autoPrint: print }));
  if (!bytes) {
    const url = new URL(req.nextUrl);
    url.pathname = url.pathname.replace(/\.pdf$/, ".html");
    url.searchParams.set("print", "1");
    return NextResponse.redirect(url, 303);
  }
  const inline = spec.ext === "html";
  return new NextResponse(bytes as BodyInit, {
    headers: {
      "Content-Type": ECO_MIME[spec.ext],
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${downloadName(doc, spec.ext)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...(inline
        ? {
            "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'${print ? "; script-src 'unsafe-inline'" : ""}`,
          }
        : {}),
    },
  });
}
