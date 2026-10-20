/**
 * Проверка адреса источника станции (host для SFTP/FTP, URL для HTTP) перед подключением.
 * Адреса задаёт администратор, но worker не должен превращаться в прокси к собственному окружению:
 * loopback, link-local (в т. ч. адреса метаданных облаков), «нулевой» адрес и служебные зоны
 * `.localhost` / `.internal` отклоняются. Частные сети (10/8, 172.16/12, 192.168/16) разрешены:
 * серверы станций и ведомственные ресурсы обычно находятся именно там.
 */
export class ForbiddenTargetError extends Error {
  constructor(target: string) {
    super(`Адрес источника запрещён: ${target}`);
    this.name = "ForbiddenTargetError";
  }
}

function ipv4Octets(host: string): number[] | null {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every((p) => p <= 255) ? parts : null;
}

export function isForbiddenHost(rawHost: string): boolean {
  const host = rawHost
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal"))
    return true;
  const v4 = ipv4Octets(host);
  if (v4) {
    const [a, b] = v4 as [number, number, number, number];
    if (a === 127 || a === 0) return true; // loopback, «этот хост»
    if (a === 169 && b === 254) return true; // link-local, metadata (169.254.169.254)
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (host.includes(":")) {
    // IPv6: loopback, unspecified, link-local, IPv4-mapped loopback/link-local.
    if (host === "::1" || host === "::") return true;
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
    const mapped = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped?.[1]) return isForbiddenHost(mapped[1]);
    return false;
  }
  return false;
}

/** Бросает ForbiddenTargetError для запрещённого host (sftp/ftp) или URL (http, json). */
export function assertAllowedTarget(
  kind: "sftp" | "ftp" | "ftps" | "http" | "json",
  target: string,
): void {
  if (kind === "http" || kind === "json") {
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      throw new ForbiddenTargetError(target);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:")
      throw new ForbiddenTargetError(target);
    if (isForbiddenHost(url.hostname)) throw new ForbiddenTargetError(target);
    return;
  }
  if (isForbiddenHost(target)) throw new ForbiddenTargetError(target);
}
