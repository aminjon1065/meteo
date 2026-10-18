import { createReadStream, statSync } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Раздача PNG‑слоёв SILAM из общего тома worker'а (SILAM_DIR; в продакшене то же делает Caddy).
 * Путь: /silam/<прогон YYYYMMDDHH>/<вещество>/<час 000>.png — файлы прогона неизменяемы.
 */
const SILAM_DIR = process.env.SILAM_DIR ?? resolve(process.cwd(), "../../data/silam");
const PATH_RE = /^\d{10}\/[A-Z0-9]{2,8}\/\d{3}\.png$/;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const rel = path.join("/");
  if (!PATH_RE.test(rel)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const file = resolve(SILAM_DIR, rel);
  let size: number;
  try {
    const stat = statSync(/* turbopackIgnore: true */ file);
    if (!stat.isFile()) throw new Error("not a file");
    size = stat.size;
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const stream = Readable.toWeb(
    createReadStream(/* turbopackIgnore: true */ file),
  ) as ReadableStream;
  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(size),
      "Cache-Control": "public, max-age=86400, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
