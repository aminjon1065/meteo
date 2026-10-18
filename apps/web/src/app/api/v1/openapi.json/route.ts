import { isLocale, type Locale } from "@meteo/i18n";
import { type NextRequest, NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { buildOpenApi } from "@/lib/api/openapi";

export const dynamic = "force-dynamic";

/** GET /api/v1/openapi.json?lang=ru — спецификация OpenAPI 3.1 публичного API (из Zod‑схем). */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("lang");
  const locale: Locale = isLocale(raw) ? raw : "en";
  const t = await getTranslations({ locale, namespace: "apiDocs" });
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  const doc = buildOpenApi({ baseUrl, locale, t: (key, values) => t(key as "info.title", values) });
  return NextResponse.json(doc, {
    headers: {
      "Content-Type": "application/vnd.oai.openapi+json; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
