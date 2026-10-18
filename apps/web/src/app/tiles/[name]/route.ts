import { createReadStream, statSync } from "node:fs";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Раздача PMTiles с поддержкой Range‑запросов (нужна клиенту pmtiles).
 * В продакшене тот же каталог может отдавать Caddy напрямую (/tiles/*).
 * Каталог: TILES_DIR (по умолчанию infra/data/tiles в монорепозитории).
 */
const TILES_DIR = process.env.TILES_DIR ?? resolve(process.cwd(), "../../infra/data/tiles");
const NAME_RE = /^[a-z0-9_-]+\.(pmtiles|json)$/;

function resolveFile(name: string) {
  if (!NAME_RE.test(name)) return null;
  const path = resolve(TILES_DIR, name);
  try {
    const stat = statSync(/* turbopackIgnore: true */ path);
    return stat.isFile() ? { path, size: stat.size } : null;
  } catch {
    return null;
  }
}

const commonHeaders = (size: number, name: string) => ({
  "Accept-Ranges": "bytes",
  "Content-Type": name.endsWith(".json") ? "application/json" : "application/octet-stream",
  "Cache-Control": "public, max-age=86400, immutable",
  "Access-Control-Allow-Origin": "*",
  "X-Total-Size": String(size),
});

export async function HEAD(_req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const file = resolveFile(name);
  if (!file) return new NextResponse(null, { status: 404 });
  return new NextResponse(null, {
    status: 200,
    headers: { ...commonHeaders(file.size, name), "Content-Length": String(file.size) },
  });
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const file = resolveFile(name);
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });

  const range = req.headers.get("range");
  let start = 0;
  let end = file.size - 1;
  let status = 200;
  if (range) {
    const m = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!m)
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${file.size}` },
      });
    if (m[1] !== "") start = Number(m[1]);
    if (m[2] !== "") end = Number(m[2]);
    if (m[1] === "" && m[2] !== "") {
      start = Math.max(0, file.size - Number(m[2]));
      end = file.size - 1;
    }
    end = Math.min(end, file.size - 1);
    if (start > end || start >= file.size) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${file.size}` },
      });
    }
    status = 206;
  }
  const stream = Readable.toWeb(
    createReadStream(/* turbopackIgnore: true */ file.path, { start, end }),
  ) as ReadableStream;
  const headers: Record<string, string> = {
    ...commonHeaders(file.size, name),
    "Content-Length": String(end - start + 1),
  };
  if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${file.size}`;
  return new NextResponse(stream, { status, headers });
}
