import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CapParseError, maskUrl, parseCapAlert, parseCapFeed } from "@meteo/core";
import {
  type CapSyncState,
  capAlerts,
  getCapSyncState,
  inArray,
  ingestCapAlert,
  setCapSyncState,
} from "@meteo/db";
import { db } from "../db";
import { env } from "../env";
import { withLock } from "../lock";
import { logger } from "../logger";
import { fetchWithRetry, runIntegration } from "../resilience";
import type { JobDefinition } from "./types";

interface CapSyncData {
  /** Игнорировать ETag/If-Modified-Since и уже загруженные ссылки. */
  force?: boolean;
  /** Переопределить источник (ручной запуск). */
  url?: string;
}

const PARALLEL = 4;
const USER_AGENT = "meteoportal-worker/0.1 (+meteo.tj; cap-sync)";

interface Sources {
  kind: string;
  notModified: boolean;
  links: string[];
  inline: string[];
  etag: string | null;
  lastModified: string | null;
}

function isFileUrl(url: string): boolean {
  return url.startsWith("file:");
}

/** Список источников: фид/каталог по HTTP или файл/каталог с фикстурами. */
async function loadSources(
  url: string,
  conditional: { etag?: string | null; lastModified?: string | null },
): Promise<Sources> {
  if (isFileUrl(url)) {
    const path = fileURLToPath(url);
    const st = await stat(path);
    if (st.isDirectory()) {
      const files = (await readdir(path)).filter((f) => /\.xml$/i.test(f)).sort();
      return {
        kind: "dir",
        notModified: false,
        links: files.map((f) => pathToFileURL(join(path, f)).href),
        inline: [],
        etag: null,
        lastModified: null,
      };
    }
    const body = await readFile(path, "utf8");
    const feed = parseCapFeed(body, url);
    return { ...feed, notModified: false, etag: null, lastModified: null };
  }
  const headers: Record<string, string> = {
    accept:
      "application/cap+xml, application/atom+xml, application/rss+xml, application/xml, text/xml, text/html;q=0.5",
    "user-agent": USER_AGENT,
  };
  if (conditional.etag) headers["if-none-match"] = conditional.etag;
  if (conditional.lastModified) headers["if-modified-since"] = conditional.lastModified;
  const res = await fetchWithRetry(
    url,
    { headers },
    {
      retries: 2,
      baseDelayMs: 2_000,
      maxDelayMs: 15_000,
      timeoutMs: env.CAP_TIMEOUT_MS,
      label: "cap",
    },
  );
  if (res.status === 304) {
    return {
      kind: "not-modified",
      notModified: true,
      links: [],
      inline: [],
      etag: conditional.etag ?? null,
      lastModified: conditional.lastModified ?? null,
    };
  }
  if (!res.ok) throw new Error(`CAP HTTP ${res.status} для ${url}`);
  const body = await res.text();
  const feed = parseCapFeed(body, url);
  if (feed.kind === "unknown") throw new Error(`CAP: неизвестный формат источника ${url}`);
  return {
    ...feed,
    notModified: false,
    etag: res.headers.get("etag"),
    lastModified: res.headers.get("last-modified"),
  };
}

async function readAlert(link: string): Promise<string> {
  if (isFileUrl(link)) return readFile(fileURLToPath(link), "utf8");
  const res = await fetchWithRetry(
    link,
    {
      headers: {
        accept: "application/cap+xml, application/xml, text/xml",
        "user-agent": USER_AGENT,
      },
    },
    {
      retries: 1,
      baseDelayMs: 2_000,
      maxDelayMs: 10_000,
      timeoutMs: env.CAP_TIMEOUT_MS,
      label: "cap",
    },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/**
 * Синхронизация CAP‑предупреждений SmartMet Alert: источник CAP_FEED_URL (Atom/RSS‑фид,
 * HTTP‑каталог или file://), ETag/If-Modified-Since, идемпотентная загрузка по identifier+sent,
 * Update/Cancel → superseded_by. Статус последнего запуска — в settings (cap.sync), состояние
 * устойчивости (circuit breaker, серия сбоев) — settings integration.cap (см. ../resilience.ts).
 * Без CAP_FEED_URL задача пропускается, не считаясь сбоем.
 */
export const capSync: JobDefinition<CapSyncData> = {
  name: "cap-sync",
  schedule: { every: 5 * 60_000 },
  async run(job) {
    const data = job.data ?? {};
    const url = data.url ?? env.CAP_FEED_URL;
    if (!url) {
      const result = await withLock("cap-sync", 60, () => syncCap(data));
      return result ?? { skipped: true, reason: "locked" };
    }
    const result = await withLock("cap-sync", 4 * 60, () =>
      runIntegration("cap", job, () => syncCap(data), {
        force: data.force,
        source: maskUrl(url),
        summarize: (r) =>
          r && typeof r === "object" && "status" in r
            ? { status: r.status, fetched: r.fetched, inserted: r.inserted, failed: r.failed }
            : r && typeof r === "object" && "notModified" in r
              ? { notModified: true }
              : null,
      }),
    );
    if (result === null) {
      logger.info("cap-sync already running, skipped");
      return { skipped: true, reason: "locked" };
    }
    return result;
  },
};

async function syncCap(data: CapSyncData) {
  const at = new Date().toISOString();
  const url = data.url ?? env.CAP_FEED_URL;
  if (!url) {
    await setCapSyncState(db, { at, status: "disabled", message: "CAP_FEED_URL не задан" });
    logger.info("CAP_FEED_URL не задан — cap-sync пропущен");
    return { skipped: true, reason: "not-configured" };
  }
  const previous = await getCapSyncState(db);
  const reuseConditional =
    !data.force &&
    previous?.url === url &&
    (previous.status === "ok" || previous.status === "not-modified");
  const sources = await loadSources(
    url,
    reuseConditional ? { etag: previous?.etag, lastModified: previous?.lastModified } : {},
  );
  if (sources.notModified) {
    const state: CapSyncState = { ...(previous ?? {}), at, status: "not-modified", url };
    await setCapSyncState(db, state);
    logger.info({ url }, "cap feed not modified");
    return { notModified: true };
  }

  const known =
    sources.links.length && !data.force
      ? await db
          .select({ sourceUrl: capAlerts.sourceUrl })
          .from(capAlerts)
          .where(inArray(capAlerts.sourceUrl, sources.links))
      : [];
  const knownSet = new Set(known.map((k) => k.sourceUrl));
  const todo = sources.links.filter((l) => !knownSet.has(l));

  const errors: Array<{ source: string; error: string }> = [];
  let fetched = 0;
  let inserted = 0;
  let superseded = 0;
  const handle = async (xml: string, sourceUrl: string) => {
    const alert = parseCapAlert(xml);
    const r = await ingestCapAlert(db, alert, { rawXml: xml, sourceUrl });
    if (r.inserted) inserted += 1;
    superseded += r.superseded;
    logger.debug(
      { identifier: alert.identifier, msgType: alert.msgType, inserted: r.inserted },
      "cap alert ingested",
    );
  };
  const fail = (source: string, error: unknown) => {
    const message =
      error instanceof CapParseError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    errors.push({ source, error: message.slice(0, 300) });
    logger.warn({ source, err: message }, "cap alert failed");
  };

  for (const [i, xml] of sources.inline.entries()) {
    try {
      await handle(xml, url);
    } catch (error) {
      fail(`${url}#${i}`, error);
    }
  }
  for (let i = 0; i < todo.length; i += PARALLEL) {
    const batch = todo.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(
      batch.map(async (link) => {
        const xml = await readAlert(link);
        fetched += 1;
        await handle(xml, link);
      }),
    );
    results.forEach((r, k) => {
      if (r.status === "rejected") fail(batch[k] ?? "?", r.reason);
    });
  }

  const attempted = todo.length + sources.inline.length;
  const status: CapSyncState["status"] =
    errors.length === 0 ? "ok" : errors.length >= attempted ? "failed" : "partial";
  await setCapSyncState(db, {
    at,
    status,
    url,
    etag: sources.etag,
    lastModified: sources.lastModified,
    fetched,
    inserted,
    superseded,
    errors: errors.slice(0, 10),
  });
  const summary = {
    kind: sources.kind,
    links: sources.links.length,
    skipped: sources.links.length - todo.length,
    fetched,
    inserted,
    superseded,
    failed: errors.length,
    status,
  };
  if (status === "failed") throw new Error(`CAP: все сообщения с ошибками (${errors[0]?.error})`);
  logger.info(summary, "cap synced");
  return summary;
}
