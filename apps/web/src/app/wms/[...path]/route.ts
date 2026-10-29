import {
  buildWmsGetMapUrl,
  isValidTile,
  parseCompactTime,
  tileBbox3857,
  tileIntersects,
} from "@meteo/core";
import { type NextRequest, NextResponse } from "next/server";
import {
  WEATHER_AREA,
  WEATHER_MAX_ZOOM,
  WEATHER_MIN_ZOOM,
  WEATHER_WMS_LAYERS,
  type WeatherWmsLayer,
} from "@/components/map/weather-layers";
import { smartmetWmsUrl } from "@/lib/weather-catalog";

export const dynamic = "force-dynamic";

const TILE_SIZE = 256;
const TIMEOUT_MS = 15_000;

function notFound() {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

/**
 * Тайлы слоёв погоды SmartMet Server (WMS GetMap) для MapLibre:
 * /wms/<прогон YYYYMMDDHHmm>/<слой>/<срок YYYYMMDDTHHmm>/<z>/<x>/<y>.png.
 * SmartMet доступен только во внутренней сети Docker; сюда пропускаются лишь продукты из белого списка,
 * тайлы в пределах области модели и уровней карты. Адрес содержит прогон и срок, поэтому ответ
 * неизменяем и кэшируется браузером и Cloudflare.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const base = smartmetWmsUrl();
  if (!base) return notFound();
  const { path } = await ctx.params;
  if (path.length !== 6) return notFound();
  const [runRaw, layerRaw, timeRaw, zRaw, xRaw, yFile] = path as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const run = /^\d{12}$/.test(runRaw)
    ? parseCompactTime(`${runRaw.slice(0, 8)}T${runRaw.slice(8)}`)
    : null;
  const time = parseCompactTime(timeRaw);
  if (!run || !time) return notFound();
  if (!(WEATHER_WMS_LAYERS as readonly string[]).includes(layerRaw)) return notFound();
  const layer = layerRaw as WeatherWmsLayer;
  const yMatch = /^(\d{1,7})\.png$/.exec(yFile);
  if (!/^\d{1,2}$/.test(zRaw) || !/^\d{1,7}$/.test(xRaw) || !yMatch) return notFound();
  const z = Number(zRaw);
  const x = Number(xRaw);
  const y = Number(yMatch[1]);
  if (z < WEATHER_MIN_ZOOM || z > WEATHER_MAX_ZOOM || !isValidTile(z, x, y)) return notFound();
  if (!tileIntersects(z, x, y, WEATHER_AREA)) return notFound();

  const url = buildWmsGetMapUrl(base, {
    layers: [`tajikistan:${layer}`],
    bbox: tileBbox3857(z, x, y),
    width: TILE_SIZE,
    height: TILE_SIZE,
    time: time.toISOString().replace(".000Z", "Z"),
    referenceTime: run.toISOString().replace(".000Z", "Z"),
  });
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    return NextResponse.json(
      { error: "smartmet unavailable" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !type.startsWith("image/png") || !res.body) {
    await res.body?.cancel().catch(() => undefined);
    return NextResponse.json(
      { error: `smartmet: HTTP ${res.status}` },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
  const headers: Record<string, string> = {
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=86400, immutable",
    "Access-Control-Allow-Origin": "*",
  };
  // fetch распаковывает gzip сам: длину передаём, только если тело пришло без сжатия.
  const length = res.headers.get("content-length");
  if (length && !res.headers.get("content-encoding")) headers["Content-Length"] = length;
  return new NextResponse(res.body, { status: 200, headers });
}
