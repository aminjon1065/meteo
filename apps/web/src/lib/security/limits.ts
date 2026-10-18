import { type NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import {
  checkRateLimit,
  clientIp,
  MemoryRateLimitStore,
  type RateLimitRule,
  type RateLimitStore,
  RedisRateLimitStore,
  rateLimitHeaders,
} from "./rate-limit";

export interface RateLimitGroup {
  name: "api" | "auth" | "ingest";
  rule: RateLimitRule;
}

const WINDOW_MS = 60_000;

function perMinute(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * Группы ограничений по пути (на IP, окно 1 минута):
 *  - /api/v1/ingest/* — приём данных станций (RATE_LIMIT_INGEST_PER_MINUTE, по умолчанию 60;
 *                  ключ — код станции + IP, чтобы один логгер не исчерпывал лимит остальных);
 *  - /api/v1/*   — публичный JSON API (RATE_LIMIT_API_PER_MINUTE, по умолчанию 120);
 *  - /api/auth/* — better-auth (RATE_LIMIT_AUTH_PER_MINUTE, по умолчанию 30; внутри better-auth
 *                  действуют свои лимиты на вход и проверку кода 2FA — 5/мин).
 * Значение 0 выключает ограничение (нагрузочные проверки).
 */
export function rateLimitGroupFor(pathname: string): RateLimitGroup | null {
  if (pathname.startsWith("/api/v1/ingest/")) {
    return {
      name: "ingest",
      rule: { limit: perMinute("RATE_LIMIT_INGEST_PER_MINUTE", 60), windowMs: WINDOW_MS },
    };
  }
  if (pathname.startsWith("/api/v1/")) {
    return {
      name: "api",
      rule: { limit: perMinute("RATE_LIMIT_API_PER_MINUTE", 120), windowMs: WINDOW_MS },
    };
  }
  if (pathname.startsWith("/api/auth/")) {
    return {
      name: "auth",
      rule: { limit: perMinute("RATE_LIMIT_AUTH_PER_MINUTE", 30), windowMs: WINDOW_MS },
    };
  }
  return null;
}

const globalRef = globalThis as unknown as {
  __meteoRateLimitMemory?: MemoryRateLimitStore;
  __meteoRateLimitRedis?: RedisRateLimitStore | null;
};

function memoryStore(): MemoryRateLimitStore {
  globalRef.__meteoRateLimitMemory ??= new MemoryRateLimitStore();
  return globalRef.__meteoRateLimitMemory;
}

function primaryStore(): RateLimitStore {
  if (globalRef.__meteoRateLimitRedis === undefined) {
    const redis = getRedis();
    globalRef.__meteoRateLimitRedis = redis ? new RedisRateLimitStore(redis) : null;
  }
  return globalRef.__meteoRateLimitRedis ?? memoryStore();
}

/** Ключ счётчика: группа + IP; для ingest — ещё код станции из пути. */
export function rateLimitKey(group: RateLimitGroup, pathname: string, ip: string): string {
  if (group.name === "ingest") {
    const code = decodeURIComponent(pathname.split("/")[4] ?? "")
      .toUpperCase()
      .slice(0, 32);
    return `ingest:${code}:${ip}`;
  }
  return `${group.name}:${ip}`;
}

/** Проверяет лимит для запроса к API; возвращает 429 или пропускает дальше с заголовками X-RateLimit-*. */
export async function enforceRateLimit(request: NextRequest): Promise<NextResponse> {
  const group = rateLimitGroupFor(request.nextUrl.pathname);
  if (!group) return NextResponse.next();
  const result = await checkRateLimit(
    primaryStore(),
    rateLimitKey(group, request.nextUrl.pathname, clientIp(request.headers)),
    group.rule,
    memoryStore(),
  );
  const headers = rateLimitHeaders(result);
  if (!result.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many requests, retry later" },
      { status: 429, headers: { ...headers, "Cache-Control": "no-store" } },
    );
  }
  const response = NextResponse.next();
  for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
  return response;
}
