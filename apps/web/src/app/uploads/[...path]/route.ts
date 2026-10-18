import { createReadStream, statSync } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { type NextRequest, NextResponse } from "next/server";
import { UPLOAD_PATH_RE, UPLOADS_DIR } from "@/lib/uploads";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
};

/** Раздача загрузок CMS из UPLOADS_DIR (в продакшене то же делает Caddy из тома uploads). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const rel = path.join("/");
  if (!UPLOAD_PATH_RE.test(rel)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const file = resolve(UPLOADS_DIR, rel);
  let size: number;
  try {
    const stat = statSync(/* turbopackIgnore: true */ file);
    if (!stat.isFile()) throw new Error("not a file");
    size = stat.size;
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const ext = rel.slice(rel.lastIndexOf(".") + 1);
  const fileName = rel.slice(rel.lastIndexOf("/") + 1);
  const stream = Readable.toWeb(
    createReadStream(/* turbopackIgnore: true */ file),
  ) as ReadableStream;
  // PDF — только как вложение: документ с активным содержимым не должен открываться в origin портала
  // (docs/security-checklist.md). Изображения проверены по сигнатуре при загрузке и отдаются inline.
  const disposition = ext === "pdf" ? "attachment" : "inline";
  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": TYPES[ext] ?? "application/octet-stream",
      "Content-Length": String(size),
      "Content-Disposition": `${disposition}; filename="${fileName}"`,
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=604800, immutable",
    },
  });
}
