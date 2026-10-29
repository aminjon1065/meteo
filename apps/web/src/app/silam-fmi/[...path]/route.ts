import { FMI_SILAM_FOLDERS, fmiSilamFolder, parseFmiSilamFramePath } from "@meteo/core/silam-fmi";
import { type NextRequest, NextResponse } from "next/server";
import { loadFmiSilamCatalog, loadFmiSilamFrame } from "@/lib/silam-fmi";

export const dynamic = "force-dynamic";

function noStore(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * Кадры карт SILAM от FMI для страницы /air/silam:
 * /silam-fmi/<прогон YYYYMMDD>/<показатель>/<час 000…048>.png.
 * Сюда пропускаются только показатели и часы из белого списка (@meteo/core/silam-fmi), запрос к FMI
 * строится из них же. Кадр прогона не меняется, поэтому ответ кэшируется браузером и Cloudflare,
 * а у FMI каждый кадр скачивается один раз.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const frame = parseFmiSilamFramePath(path);
  if (!frame) return noStore(404, "not found");
  const catalog = await loadFmiSilamCatalog();
  if (!catalog) return noStore(502, "fmi unavailable");
  const folder = fmiSilamFolder(new Date(catalog.originTime), frame.origin);
  if (folder === null) return noStore(404, "run not available");
  // Если FMI уже выпустил новый прогон, нужный окажется на каталог дальше.
  const folders = folder + 1 < FMI_SILAM_FOLDERS ? [folder, folder + 1] : [folder];
  const result = await loadFmiSilamFrame(frame.product, frame.origin, frame.hour, folders);
  if (result.status === "missing") return noStore(404, "frame not available");
  if (result.status === "error") {
    console.warn(`[silam-fmi] кадр ${path.join("/")}: ${result.message}`);
    return noStore(502, "fmi unavailable");
  }
  return new NextResponse(Buffer.from(result.body), {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Content-Length": String(result.body.byteLength),
      "Cache-Control": "public, max-age=86400, immutable",
    },
  });
}
