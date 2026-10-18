import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import createIntlMiddleware from "next-intl/middleware";
import { routing } from "@/i18n/routing";
import { buildCsp, generateNonce, isEmbedPath, parseEmbedAncestors } from "@/lib/security/csp";
import { enforceRateLimit } from "@/lib/security/limits";

const intl = createIntlMiddleware(routing);
const adminPath = /^(?:\/(tg|ru|en))?\/admin(?:\/(.*))?$/;
const isDev = process.env.NODE_ENV === "development";
const embedAncestors = parseEmbedAncestors(process.env.EMBED_FRAME_ANCESTORS);

/**
 * 1. /api/v1 и /api/auth — ограничение частоты запросов (Redis, на IP), остальное API не трогаем.
 * 2. Оптимистичная защита /admin: без cookie сессии — на страницу входа.
 *    Полная проверка сессии и роли выполняется в layout админки на сервере.
 * 3. Локализация маршрутов next-intl (rewrite на /{locale}/… или redirect).
 * 4. Content Security Policy с nonce на каждый запрос страницы. Nonce передаётся Next.js заголовком
 *    запроса content-security-policy (Next сам проставляет его своим скриптам) и доступен в layout
 *    как x-nonce. Виджетам /embed/* разрешено встраивание в iframe только с сайтов Агентства.
 */
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) return enforceRateLimit(request);

  const match = pathname.match(adminPath);
  if (match && !(match[2] ?? "").startsWith("login")) {
    if (!getSessionCookie(request)) {
      const url = request.nextUrl.clone();
      url.pathname = `${match[1] ? `/${match[1]}` : ""}/admin/login`;
      url.search = "";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
  }

  const intlResponse = intl(request);
  if (intlResponse.headers.has("location")) return intlResponse;

  const nonce = generateNonce();
  const embed = isEmbedPath(pathname);
  const csp = buildCsp({
    nonce,
    dev: isDev,
    embed,
    embedAncestors,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
  });
  return withRequestHeaders(
    request,
    intlResponse,
    { "x-nonce": nonce, "content-security-policy": csp },
    (response) => {
      response.headers.set("Content-Security-Policy", csp);
      if (!embed) response.headers.set("X-Frame-Options", "DENY");
    },
  );
}

/**
 * Пересобирает ответ next-intl (rewrite или next) с дополнительными заголовками запроса: заголовки,
 * которые next-intl уже переопределил (x-next-intl-locale), сохраняются; cookie локали и Link
 * (hreflang) копируются. Запрос не клонируется: NextRequest, созданный из копии, получает host из
 * заголовка Host, и Next в production считает rewrite на другой origin внешним — запрос уходит
 * на сам сервер, proxy выполняется второй раз и возвращает redirect (цикл 307).
 */
function withRequestHeaders(
  request: NextRequest,
  source: NextResponse,
  extra: Record<string, string>,
  decorate: (response: NextResponse) => void,
): NextResponse {
  const headers = new Headers(request.headers);
  for (const name of (source.headers.get("x-middleware-override-headers") ?? "").split(",")) {
    const key = name.trim();
    const value = key ? source.headers.get(`x-middleware-request-${key}`) : null;
    if (key && value !== null) headers.set(key, value);
  }
  for (const [key, value] of Object.entries(extra)) headers.set(key, value);
  const rewrite = source.headers.get("x-middleware-rewrite");
  const response = rewrite
    ? NextResponse.rewrite(rewrite, { request: { headers } })
    : NextResponse.next({ request: { headers } });
  source.headers.forEach((value, key) => {
    if (key.startsWith("x-middleware-") || key === "set-cookie") return;
    response.headers.set(key, value);
  });
  for (const cookie of source.headers.getSetCookie()) response.headers.append("set-cookie", cookie);
  decorate(response);
  return response;
}

export const config = {
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)", "/api/v1/:path*", "/api/auth/:path*"],
};
