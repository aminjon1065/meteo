/**
 * Сеть PM‑датчиков Агентства (открытый API подрядчика wwcs.tj) → реестр станций
 * портала и JSON‑источник для задачи worker'а station-pull (docs/02-architecture.md §8.4, runbook §9.4).
 *
 *   pnpm --filter @meteo/db import-wwcs -- [--url https://wwcs.tj/services/airquality/stations | --file stations.json]
 *     [--anchor DYU01_ECO] [--disabled] [--stale-min 60] [--history-hours 24] [--suspend DYU006_ECO]
 *     [--no-source] [--update] [--dry-run]
 *
 * Что делает: читает список датчиков (`stationID`, `siteName`, координаты, высота), создаёт станции
 * (код = stationID, названия tg/ru/en из таблицы ниже, kind air, автоматический датчик, непрерывный ряд,
 * вещества PM2.5 и PM10 в µg/m³, регион и район — по координатам через PostGIS) и один источник типа
 * `json` в карточке станции --anchor: записи раскладываются по станциям по полю stationID. Идемпотентен:
 * существующие станции не трогает (кроме --update: координаты, высота, названия), источник не дублирует.
 * Источник — основной канал данных сети PM‑датчиков Агентства — создаётся включённым: worker опросит API в
 * ближайшем цикле station-pull (`--disabled` — создать выключенным, переключатель есть и в карточке станции).
 * Станции из --suspend (по умолчанию DYU006_ECO — датчик в здании Агентства выдаёт заведомо неверные
 * значения) создаются со статусом «приостановлена».
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { type JsonFeedMapping, slugify } from "@meteo/core";
import type { I18nText } from "@meteo/i18n";
import { and, eq, sql } from "drizzle-orm";
import { createDb } from "../client";
import { loadRootEnv, requireEnv } from "../env";
import * as s from "../schema";

const DEFAULT_URL = "https://wwcs.tj/services/airquality/stations";
const DEFAULT_HISTORY_URL = "https://wwcs.tj/services/airquality/history?hours={hours}";

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a, i) => !(i === 0 && a === "--")),
  allowPositionals: true,
  options: {
    url: { type: "string", default: DEFAULT_URL },
    file: { type: "string" },
    anchor: { type: "string", default: "DYU01_ECO" },
    disabled: { type: "boolean", default: false },
    "stale-min": { type: "string", default: "60" },
    "history-hours": { type: "string", default: "24" },
    suspend: { type: "string", default: "DYU006_ECO" },
    "no-source": { type: "boolean", default: false },
    update: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (args.help) {
  console.info(`Импорт станций сети PM‑датчиков Агентства (wwcs.tj).
  --url URL          адрес списка датчиков (${DEFAULT_URL})
  --file path        сохранённый ответ /airquality/stations вместо запроса в сеть
  --anchor CODE      станция, в карточке которой заводится JSON‑источник (DYU01_ECO)
  --disabled         создать источник выключенным (по умолчанию включён: опрос с ближайшего цикла)
  --stale-min N      порог письма «нет данных» у источника, мин (60)
  --history-hours N  глубина догрузки истории при первом запуске/проверке, ч (24)
  --suspend A,B      коды станций со статусом «приостановлена» (DYU006_ECO)
  --no-source        только станции, без источника
  --update           обновить координаты, высоту и названия существующих станций
  --dry-run          показать, что будет сделано, ничего не записывая`);
  process.exit(0);
}

interface WwcsStation {
  stationID: string;
  siteName?: string;
  latitude: number;
  longitude: number;
  altitude?: number | null;
  timestamp?: string;
  PM25?: number | null;
  PM10?: number | null;
}

const t = (tg: string, ru: string, en: string): I18nText => ({ tg, ru, en });

/** Названия станций сети (tg) и переводы; siteName API — техническое, остаётся в описании. */
const NAMES: Record<string, I18nText> = {
  DYU01_ECO: t(
    "Шукуфон 59 (Медгородок)",
    "Ул. Шукуфон, 59 (Медгородок)",
    "Shukufon St. 59 (Medgorodok)",
  ),
  HIS003_ECO: t("Маркази шаҳри Ҳисор", "Центр города Гиссар", "Hisor city centre"),
  KULOB006_ECO: t(
    "Идораи экологии Кӯлоб",
    "Управление экологии, Куляб",
    "Environmental office, Kulob",
  ),
  DYU007_ECO: t(
    "Боғи фарҳангу фароғатии ба номи С. Айнӣ, ш. Душанбе",
    "Парк культуры и отдыха им. С. Айни, г. Душанбе",
    "S. Ayni Park of Culture and Recreation, Dushanbe",
  ),
  DYU012_ECO: t(
    "Институти физикаю техникаи ба номи С.У. Умарови АМИТ",
    "Физико-технический институт им. С.У. Умарова НАНТ",
    "S.U. Umarov Physical-Technical Institute, NAST",
  ),
  DYU010_ECO: t(
    "Литсеи Президенти ш. Душанбе",
    "Президентский лицей, г. Душанбе",
    "Presidential Lyceum, Dushanbe",
  ),
  DYU008_ECO: t(
    "МТМУ №77-и ш. Душанбе",
    "Средняя школа №77, г. Душанбе",
    "Secondary school No. 77, Dushanbe",
  ),
  DYU006_ECO: t(
    "Агентии обуҳавошиносӣ",
    "Агентство по гидрометеорологии",
    "Agency for Hydrometeorology",
  ),
  VAH001_ECO: t("Маркази шаҳри Ваҳдат", "Центр города Вахдат", "Vahdat city centre"),
};

const DESCRIPTION = t(
  "Датчики PM2.5/PM10‑и шабакаи мониторинги сифати ҳавои Агентӣ. Маълумот ҳар 10 дақиқа тавассути API‑и кушоди wwcs.tj.",
  "Датчик PM2.5/PM10 сети мониторинга качества воздуха Агентства. Данные каждые 10 минут через открытый API wwcs.tj.",
  "PM2.5/PM10 sensor of the Agency's air quality monitoring network. Data every 10 minutes via the open wwcs.tj API.",
);
const SUSPENDED_NOTE = t(
  "Истгоҳ боздошта шудааст: датчик қиматҳои баръало нодуруст медиҳад (садҳо мкг/м³ ҳангоми заминаи муқаррарӣ); пас аз таъмири датчик фаъол кунед.",
  "Станция приостановлена: датчик выдаёт заведомо неверные значения (сотни мкг/м³ при нормальном фоне у соседних станций); включить после ремонта датчика.",
  "Station suspended: the sensor reports clearly wrong values (hundreds of µg/m³ against a normal background at neighbouring stations); enable after the sensor is repaired.",
);

/** Маппинг ответа wwcs.tj: местное время (UTC+5) без смещения, 10‑минутные значения, история для пропусков. */
export function wwcsMapping(historyHours: number): JsonFeedMapping {
  return {
    format: "json",
    stationField: "stationID",
    time: { field: "timestamp", timezone: "Asia/Dushanbe", roundMin: 10 },
    pollutants: {
      PM25: { field: "PM25", unit: "µg/m³" },
      PM10: { field: "PM10", unit: "µg/m³" },
    },
    averagingMin: 10,
    history: { url: DEFAULT_HISTORY_URL, hours: historyHours, maxHours: 72 },
  };
}

function joinText(a: I18nText, b: I18nText): I18nText {
  return { tg: `${a.tg} ${b.tg}`, ru: `${a.ru} ${b.ru}`, en: `${a.en} ${b.en}` };
}

async function loadList(): Promise<WwcsStation[]> {
  const raw = args.file
    ? JSON.parse(readFileSync(args.file, "utf8"))
    : await fetch(args.url as string, {
        headers: { accept: "application/json", "user-agent": "meteoportal-import-wwcs/0.1" },
        signal: AbortSignal.timeout(30_000),
      }).then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status} для ${args.url}`);
        return res.json();
      });
  if (!Array.isArray(raw)) throw new Error("Ответ не является массивом датчиков");
  const list = (raw as WwcsStation[]).filter(
    (r) =>
      r &&
      typeof r.stationID === "string" &&
      /^[A-Za-z0-9_-]{2,32}$/.test(r.stationID) &&
      Number.isFinite(r.latitude) &&
      Number.isFinite(r.longitude),
  );
  if (list.length === 0) throw new Error("В ответе нет датчиков с кодом и координатами");
  return list;
}

loadRootEnv();
const db = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const dryRun = Boolean(args["dry-run"]);
const suspend = new Set(
  String(args.suspend ?? "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean),
);
const staleMin = Math.max(5, Number(args["stale-min"]) || 60);
const historyHours = Math.min(168, Math.max(1, Number(args["history-hours"]) || 24));

try {
  const list = await loadList();
  console.info(`[wwcs] датчиков в ответе: ${list.length}${dryRun ? " (dry-run)" : ""}`);
  const pollutantRows = await db
    .select({ id: s.pollutants.id, code: s.pollutants.code })
    .from(s.pollutants);
  const pid = new Map(pollutantRows.map((p) => [p.code, p.id]));
  for (const code of ["PM25", "PM10"])
    if (!pid.has(code)) throw new Error(`нет вещества ${code} — выполните seed`);

  const existing = await db
    .select({ id: s.stations.id, code: s.stations.code, slug: s.stations.slug })
    .from(s.stations);
  const byCode = new Map(existing.map((r) => [r.code.toUpperCase(), r]));
  const slugs = new Set(existing.map((r) => r.slug));
  const created: string[] = [];
  const skipped: string[] = [];
  const updated: string[] = [];

  for (const st of list) {
    const code = st.stationID.toUpperCase();
    const name = NAMES[code] ?? t(st.siteName ?? code, st.siteName ?? code, st.siteName ?? code);
    if (!NAMES[code])
      console.warn(`[wwcs] ${code}: нет названия в таблице, использую siteName «${st.siteName}»`);
    const point = sql`ST_SetSRID(ST_MakePoint(${st.longitude}, ${st.latitude}), 4326)`;
    const [geo] = await db.execute<{ region_id: number | null; district_id: number | null }>(sql`
      select
        coalesce(
          (select id from regions where geom is not null and ST_Contains(geom, ${point}) limit 1),
          (select region_id from districts where geom is not null and ST_Contains(geom, ${point}) limit 1),
          (select id from regions where centroid is not null order by ST_Distance(centroid, ${point}) limit 1)
        ) as region_id,
        (select id from districts where geom is not null and ST_Contains(geom, ${point}) limit 1) as district_id
    `);
    const isSuspended = suspend.has(code);
    const description = isSuspended ? joinText(DESCRIPTION, SUSPENDED_NOTE) : DESCRIPTION;
    const previous = byCode.get(code);
    const elevation =
      typeof st.altitude === "number" && Number.isFinite(st.altitude) ? st.altitude : null;
    if (previous) {
      if (args.update && !dryRun) {
        await db
          .update(s.stations)
          .set({ name, geom: { x: st.longitude, y: st.latitude }, elevationM: elevation })
          .where(eq(s.stations.id, previous.id));
        updated.push(code);
      } else skipped.push(code);
      continue;
    }
    let slug = slugify(name.en ?? code) || slugify(code);
    if (slugs.has(slug)) slug = `${slug}-${slugify(code)}`.slice(0, 64);
    slugs.add(slug);
    console.info(
      `[wwcs] + ${code} «${name.ru}» (${st.latitude.toFixed(4)}, ${st.longitude.toFixed(4)}, ${elevation ?? "—"} м) ` +
        `регион ${geo?.region_id ?? "—"}, район ${geo?.district_id ?? "—"}${isSuspended ? ", приостановлена" : ""}`,
    );
    if (dryRun) {
      created.push(code);
      byCode.set(code, { id: -1, code, slug });
      continue;
    }
    const [row] = await db
      .insert(s.stations)
      .values({
        code,
        slug,
        name,
        kind: "air",
        geom: { x: st.longitude, y: st.latitude },
        elevationM: elevation,
        regionId: geo?.region_id ?? null,
        districtId: geo?.district_id ?? null,
        status: isSuspended ? "suspended" : "active",
        dataSource: "sensor",
        sampling: "continuous",
        description,
        isPublic: true,
      })
      .returning({ id: s.stations.id });
    if (!row) throw new Error(`станция ${code} не создана`);
    await db.insert(s.stationPollutants).values([
      { stationId: row.id, pollutantId: pid.get("PM25") as number, inputUnit: "µg/m³" },
      { stationId: row.id, pollutantId: pid.get("PM10") as number, inputUnit: "µg/m³" },
    ]);
    await db.insert(s.auditLog).values({
      actorEmail: "script:import-wwcs",
      actorRole: "system",
      action: "station.create",
      entity: "stations",
      entityId: String(row.id),
      after: { code, slug, name, status: isSuspended ? "suspended" : "active", source: "wwcs.tj" },
    });
    byCode.set(code, { id: row.id, code, slug });
    created.push(code);
  }

  let sourceNote = "источник не создавался (--no-source)";
  if (!args["no-source"]) {
    const anchorCode = String(args.anchor).toUpperCase();
    const anchor = byCode.get(anchorCode);
    if (!anchor)
      throw new Error(`станция --anchor ${anchorCode} не найдена ни в ответе, ни в реестре`);
    const url = args.url as string;
    // Чтение выполняется и в dry-run: так видно, что источник уже заведён.
    const [present] = await db
      .select({ id: s.stationSources.id, enabled: s.stationSources.enabled })
      .from(s.stationSources)
      .where(and(eq(s.stationSources.kind, "json"), eq(s.stationSources.path, url)));
    if (present) {
      sourceNote = `источник уже есть (id ${present.id}, ${present.enabled ? "включён" : "выключен"})`;
    } else if (dryRun) {
      sourceNote = `будет создан источник json → ${url} в карточке ${anchorCode}`;
    } else {
      const [src] = await db
        .insert(s.stationSources)
        .values({
          stationId: anchor.id,
          kind: "json",
          enabled: !args.disabled,
          label: "WWCS airquality API",
          host: "",
          path: url,
          filePattern: "*",
          mapping: wwcsMapping(historyHours),
          staleAfterMin: staleMin,
          createdBy: "script:import-wwcs",
        })
        .returning({ id: s.stationSources.id });
      await db.insert(s.auditLog).values({
        actorEmail: "script:import-wwcs",
        actorRole: "system",
        action: "station.source.create",
        entity: "station_sources",
        entityId: String(src?.id ?? ""),
        after: {
          stationId: anchor.id,
          stationCode: anchorCode,
          kind: "json",
          path: url,
          enabled: !args.disabled,
        },
      });
      sourceNote = `создан источник json id ${src?.id} в карточке ${anchorCode} (${args.disabled ? "выключен (--disabled)" : "включён — worker опросит API в ближайшем цикле"})`;
    }
  }

  console.info(
    `[wwcs] создано станций: ${created.length}${created.length ? ` (${created.join(", ")})` : ""}; ` +
      `уже были: ${skipped.length}${updated.length ? `; обновлено: ${updated.join(", ")}` : ""}; ${sourceNote}`,
  );
} finally {
  await db.$client.end();
}
