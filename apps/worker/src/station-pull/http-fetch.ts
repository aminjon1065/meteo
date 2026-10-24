import { type FetchRetryOptions, fetchWithRetry } from "../resilience";
import {
  assertAllowedTarget,
  assertResolvedTargetAllowed,
  type ResolveCheckOptions,
} from "./target";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
export const MAX_REDIRECTS = 5;

/**
 * Загрузка файла или JSON источника станции по http(s) с проверкой адреса на каждом шаге:
 * перенаправления обрабатываются вручную (не больше MAX_REDIRECTS), каждый новый адрес проходит
 * assertAllowedTarget и проверку после DNS — внешний сервер не может увести запрос во внутреннюю
 * сеть портала или к адресу метаданных облака. При переходе на другой origin логин и пароль
 * источника (Authorization) не передаются.
 */
export async function fetchSourceUrl(
  kind: "http" | "json",
  url: string,
  init: RequestInit,
  retry: FetchRetryOptions,
  check: ResolveCheckOptions = {},
): Promise<{ res: Response; url: string }> {
  const headers = new Headers(init.headers);
  let current = url;
  for (let hop = 0; ; hop++) {
    assertAllowedTarget(kind, current);
    await assertResolvedTargetAllowed(new URL(current).hostname, check);
    const res = await fetchWithRetry(current, { ...init, headers, redirect: "manual" }, retry);
    const location = REDIRECT_STATUSES.has(res.status) ? res.headers.get("location") : null;
    if (!location) return { res, url: current };
    await res.body?.cancel().catch(() => {});
    if (hop >= MAX_REDIRECTS) throw new Error(`Слишком много перенаправлений: ${url}`);
    const next = new URL(location, current);
    if (next.origin !== new URL(current).origin) headers.delete("authorization");
    current = next.toString();
  }
}
