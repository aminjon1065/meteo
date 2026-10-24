import { lookup as dnsLookup } from "node:dns/promises";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { type NetworkInterfaceInfo, networkInterfaces } from "node:os";

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

// ---------------------------------------------------------------------------------------------
// Проверка после DNS: имя источника может указывать на запрещённый адрес (в т. ч. имена сервисов
// Docker — postgres, redis, web — и записи DNS, нацеленные на loopback / адрес метаданных облака).
// ---------------------------------------------------------------------------------------------

export type LookupFn = (host: string) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: LookupFn = (host) => dnsLookup(host, { all: true, verbatim: true });

function ipv4ToInt(ip: string): number | null {
  const o = ipv4Octets(ip);
  if (!o) return null;
  return (((o[0] ?? 0) << 24) | ((o[1] ?? 0) << 16) | ((o[2] ?? 0) << 8) | (o[3] ?? 0)) >>> 0;
}

/**
 * Адрес в одной из сетей собственных интерфейсов процесса (IPv4, кроме loopback — он запрещён и
 * так). В контейнере это сети Docker портала (postgres, redis, web, worker): источники станций туда
 * не ходят. Частные сети Агентства (другие подсети 10/8, 172.16/12, 192.168/16) не затрагиваются.
 */
export function inOwnNetwork(
  ip: string,
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces(),
): boolean {
  const target = ipv4ToInt(ip);
  if (target === null) return false;
  for (const list of Object.values(interfaces)) {
    for (const nic of list ?? []) {
      if (nic.family !== "IPv4" || nic.internal || !nic.cidr) continue;
      const [addr, bitsRaw] = nic.cidr.split("/");
      const own = ipv4ToInt(addr ?? "");
      const bits = Number(bitsRaw);
      if (own === null || !Number.isInteger(bits) || bits < 1 || bits > 32) continue;
      const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1) >>> 0) >>> 0;
      if ((own & mask) >>> 0 === (target & mask) >>> 0) return true;
    }
  }
  return false;
}

/** Процесс в контейнере Docker: только тогда сети собственных интерфейсов — сети портала. */
export const runningInContainer = existsSync("/.dockerenv");

export interface ResolveCheckOptions {
  lookup?: LookupFn;
  interfaces?: NodeJS.Dict<NetworkInterfaceInfo[]>;
  /** Проверять собственные сети (по умолчанию — в контейнере). */
  blockOwnNetworks?: boolean;
}

/**
 * Резолвит имя хоста и отклоняет источник, если любой из адресов запрещён (isForbiddenHost) или
 * лежит в собственной сети контейнера. Остаточный риск — DNS rebinding между этой проверкой и
 * подключением (TTL 0 у домена, который задал администратор); адреса задаёт только администратор.
 */
export async function assertResolvedTargetAllowed(
  host: string,
  opts: ResolveCheckOptions = {},
): Promise<void> {
  const name = host.trim().replace(/^\[|\]$/g, "");
  if (isForbiddenHost(name)) throw new ForbiddenTargetError(host);
  const addresses = isIP(name)
    ? [name]
    : (await (opts.lookup ?? defaultLookup)(name)).map((a) => a.address);
  const blockOwn = opts.blockOwnNetworks ?? runningInContainer;
  for (const address of addresses) {
    if (isForbiddenHost(address) || (blockOwn && inOwnNetwork(address, opts.interfaces)))
      throw new ForbiddenTargetError(`${host} → ${address}`);
  }
}
