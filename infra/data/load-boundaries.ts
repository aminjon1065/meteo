/**
 * Загрузка административных границ Таджикистана в PostGIS: `regions` (geom, centroid) и `districts`.
 *
 * Источники (подробности, лицензии и порядок обновления — infra/data/boundaries/README.md):
 *  - коды (P-code = ОКАТО) и названия tg/ru/en — OCHA COD-AB Tajikistan (HDX, CC BY-IGO), выверенная
 *    таблица infra/data/boundaries/tjk-admin-units.json (геометрии в COD-AB для Таджикистана нет);
 *  - геометрия — GADM 4.1 (по умолчанию; лицензия только для некоммерческого использования) или
 *    geoBoundaries gbOpen (данные OpenStreetMap, ODbL): --source=geoboundaries.
 *
 * Запуск из корня монорепозитория (DATABASE_URL берётся из корневого .env):
 *   pnpm --filter @meteo/db boundaries [--source=gadm|geoboundaries] [--tolerance=0.002] [--dry-run] [--refresh]
 * Переменные окружения: BOUNDARIES_SOURCE, BOUNDARIES_TOLERANCE, BOUNDARIES_TMP (папка кэша загрузок).
 *
 * Скрипт идемпотентен: upsert по regions.code и districts.code в одной транзакции. Геометрия чинится
 * (ST_MakeValid) и упрощается ST_SimplifyPreserveTopology с допуском --tolerance в градусах
 * (0.002° ≈ 200 м; 0 — без упрощения). Единицы таксономии без полигона в источнике (районы Душанбе,
 * города областного подчинения) записываются с geom = NULL.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { transliterate } from "../../packages/core/src/slug";
import { createDb } from "../../packages/db/src/client";
import { loadRootEnv, requireEnv } from "../../packages/db/src/env";

// ---------------------------------------------------------------------------
// Типы
// ---------------------------------------------------------------------------
type RegionCode = "DU" | "RRP" | "SU" | "KT" | "GB";
type UnitKind = "district" | "city";

interface I18nText {
  tg: string;
  ru: string;
  en: string;
}

interface Admin1Row {
  code: RegionCode;
  pcode: string;
  sortOrder: number;
  name: I18nText;
  aliases: string[];
}

interface Admin2Row {
  pcode: string;
  region: RegionCode;
  kind: UnitKind;
  tg: string;
  ru: string;
  en?: string;
  aliases: string[];
  note?: string;
}

interface Taxonomy {
  source: { name: string; url: string; license: string; dataDate: string };
  admin1: Admin1Row[];
  admin2: Admin2Row[];
}

interface Geometry {
  type: string;
  coordinates: unknown;
}

interface Feature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: Geometry | null;
}

interface FeatureCollection {
  type: "FeatureCollection";
  features: Feature[];
}

/** Полигон источника после нормализации свойств. */
interface SourceUnit {
  id: string;
  /** Варианты названия (как в источнике) для сопоставления с таксономией. */
  names: string[];
  /** Область по данным источника, если он её указывает (GADM — да, geoBoundaries — нет). */
  region: RegionCode | null;
  geometry: Geometry;
}

interface BoundarySource {
  key: string;
  title: string;
  license: string;
  attribution: string;
  admin1Url: string;
  admin2Url: string;
  /** Идентификаторы полигонов admin2, которые заведомо не являются единицами таксономии. */
  skipAdmin2: Record<string, string>;
  admin1(
    fc: FeatureCollection,
    resolveRegion: (names: string[]) => RegionCode | null,
  ): SourceUnit[];
  admin2(
    fc: FeatureCollection,
    resolveRegion: (names: string[]) => RegionCode | null,
  ): SourceUnit[];
}

// ---------------------------------------------------------------------------
// Вспомогательные функции
// ---------------------------------------------------------------------------
const log = (msg: string) => console.info(`[boundaries] ${msg}`);
const warn = (msg: string) => console.warn(`[boundaries] ${msg}`);

/** Ключ сопоставления: строчные латинские буквы и цифры, без типа единицы, пробелов и знаков. */
function normalizeName(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+(district|city|rayon|raion|nohiya)$/u, "")
    .replace(/[^a-z0-9]/g, "");
}

function str(props: Record<string, unknown>, key: string): string {
  const v = props[key];
  return typeof v === "string" && v !== "NA" ? v : "";
}

/** Варианты названия GADM: VARNAME_* разделены «|». */
function splitVariants(value: string): string[] {
  return value
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** «ayni» → «Ayni», «kuhistoni mastchoh» → «Kuhistoni Mastchoh». */
function titleCase(input: string): string {
  return input.replace(/(^|[\s-])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

function isFeatureCollection(value: unknown): value is FeatureCollection {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { type?: unknown }).type === "FeatureCollection" &&
    Array.isArray((value as { features?: unknown }).features)
  );
}

async function fetchJson(url: string, dest: string, refresh: boolean): Promise<FeatureCollection> {
  if (!refresh && existsSync(dest)) {
    log(`кэш: ${dest}`);
  } else {
    log(`скачиваю ${url}`);
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) {
      throw new Error(`не удалось скачать ${url}: HTTP ${res.status} ${res.statusText}`);
    }
    const text = await res.text();
    if (!isFeatureCollection(JSON.parse(text))) {
      throw new Error(`${url}: ответ не является GeoJSON FeatureCollection`);
    }
    writeFileSync(dest, text);
  }
  const parsed: unknown = JSON.parse(readFileSync(dest, "utf8"));
  if (!isFeatureCollection(parsed)) {
    throw new Error(
      `${dest}: файл не является GeoJSON FeatureCollection (удалите кэш или --refresh)`,
    );
  }
  return parsed;
}

function requireGeometry(feature: Feature, id: string): Geometry {
  const g = feature.geometry;
  if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) {
    throw new Error(`полигон ${id}: ожидается Polygon/MultiPolygon, получено ${g?.type ?? "null"}`);
  }
  return g;
}

// ---------------------------------------------------------------------------
// Источники геометрии
// ---------------------------------------------------------------------------
const GADM: BoundarySource = {
  key: "gadm",
  title: "GADM 4.1 (gadm41_TJK_1/2.json, 2022)",
  license:
    "GADM: свободно для академического и иного некоммерческого использования; распространение и коммерческое использование — только с разрешения GADM (https://gadm.org/license.html)",
  attribution: "© GADM 4.1, https://gadm.org",
  admin1Url: "https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_TJK_1.json",
  admin2Url: "https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_TJK_2.json",
  skipAdmin2: {
    // В GADM город Душанбе на уровне 2 — один полигон с ошибочным именем «Rudaki» (HASC TJ.RR.LE).
    // Городских районов Душанбе в открытых источниках нет; геометрия города хранится в regions.
    "TJK.1.1_1": "город Душанбе целиком (в GADM подписан как Rudaki)",
  },
  admin1(fc, resolveRegion) {
    return fc.features.map((f) => {
      const p = f.properties;
      const id = str(p, "GID_1");
      const names = [
        str(p, "NAME_1"),
        ...splitVariants(str(p, "VARNAME_1")),
        str(p, "HASC_1"),
        str(p, "ISO_1"),
      ];
      return { id, names, region: resolveRegion(names), geometry: requireGeometry(f, id) };
    });
  },
  admin2(fc, resolveRegion) {
    return fc.features.map((f) => {
      const p = f.properties;
      const id = str(p, "GID_2");
      const hasc = str(p, "HASC_2").split(".").slice(0, 2).join(".");
      return {
        id,
        names: [str(p, "NAME_2"), ...splitVariants(str(p, "VARNAME_2"))],
        region: resolveRegion([str(p, "NAME_1"), hasc]),
        geometry: requireGeometry(f, id),
      };
    });
  },
};

const GEOBOUNDARIES: BoundarySource = {
  key: "geoboundaries",
  title: "geoBoundaries 6.0 gbOpen TJK ADM1/ADM2 (источник — OpenStreetMap, 2017; сборка 2023-12)",
  license: "ODbL 1.0 (OpenStreetMap contributors), https://www.geoboundaries.org",
  attribution: "© OpenStreetMap contributors (ODbL), geoBoundaries",
  admin1Url:
    "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/TJK/ADM1/geoBoundaries-TJK-ADM1.geojson",
  admin2Url:
    "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/TJK/ADM2/geoBoundaries-TJK-ADM2.geojson",
  skipAdmin2: {},
  admin1(fc, resolveRegion) {
    return fc.features.map((f) => {
      const p = f.properties;
      const id = str(p, "shapeID");
      const names = [str(p, "shapeName"), str(p, "shapeISO")];
      return { id, names, region: resolveRegion(names), geometry: requireGeometry(f, id) };
    });
  },
  admin2(fc) {
    // В ADM2 geoBoundaries нет ссылки на ADM1 — область определяется по таксономии.
    return fc.features.map((f) => {
      const id = str(f.properties, "shapeID");
      return {
        id,
        names: [str(f.properties, "shapeName")],
        region: null,
        geometry: requireGeometry(f, id),
      };
    });
  },
};

const SOURCES: Record<string, BoundarySource> = { gadm: GADM, geoboundaries: GEOBOUNDARIES };

// ---------------------------------------------------------------------------
// Параметры
// ---------------------------------------------------------------------------
const { values: args } = parseArgs({
  options: {
    source: { type: "string", default: process.env.BOUNDARIES_SOURCE ?? "gadm" },
    tolerance: { type: "string", default: process.env.BOUNDARIES_TOLERANCE ?? "0.002" },
    "dry-run": { type: "boolean", default: false },
    refresh: { type: "boolean", default: false },
  },
  allowPositionals: false,
});

const source = SOURCES[args.source ?? "gadm"];
if (!source) {
  throw new Error(
    `неизвестный источник «${args.source}»; доступны: ${Object.keys(SOURCES).join(", ")}`,
  );
}
const tolerance = Number(args.tolerance);
if (!Number.isFinite(tolerance) || tolerance < 0) {
  throw new Error(`некорректный допуск упрощения: ${args.tolerance}`);
}
const dryRun = args["dry-run"] === true;
const refresh = args.refresh === true;

const here = import.meta.dirname;
const taxonomyPath = resolve(here, "boundaries/tjk-admin-units.json");
const cacheDir = join(process.env.BOUNDARIES_TMP ?? join(tmpdir(), "meteo-boundaries"), source.key);
mkdirSync(cacheDir, { recursive: true });

// ---------------------------------------------------------------------------
// Таксономия и сопоставление
// ---------------------------------------------------------------------------
const taxonomy = JSON.parse(readFileSync(taxonomyPath, "utf8")) as Taxonomy;

const regionByAlias = new Map<string, RegionCode>();
for (const a1 of taxonomy.admin1) {
  for (const alias of [a1.name.en, ...a1.aliases]) {
    regionByAlias.set(normalizeName(alias), a1.code);
  }
}
const resolveRegion = (names: string[]): RegionCode | null => {
  for (const n of names) {
    const code = regionByAlias.get(normalizeName(n));
    if (code) return code;
  }
  return null;
};

const admin2ByAlias = new Map<string, Admin2Row[]>();
for (const row of taxonomy.admin2) {
  for (const alias of row.aliases) {
    const key = normalizeName(alias);
    const list = admin2ByAlias.get(key) ?? [];
    list.push(row);
    admin2ByAlias.set(key, list);
  }
}

/**
 * Полигон источника → строка таксономии. Если у области есть и район, и одноимённый город
 * (Исфара, Кӯлоб, Ваҳдат…), полигон относится к району: в GADM/OSM город входит в его территорию.
 */
function matchAdmin2(unit: SourceUnit): Admin2Row | null {
  const candidates = new Map<string, Admin2Row>();
  for (const name of unit.names) {
    for (const row of admin2ByAlias.get(normalizeName(name)) ?? []) {
      if (unit.region === null || row.region === unit.region) candidates.set(row.pcode, row);
    }
  }
  const rows = [...candidates.values()];
  if (rows.length <= 1) return rows[0] ?? null;
  const districts = rows.filter((r) => r.kind === "district");
  if (districts.length === 1) return districts[0] ?? null;
  throw new Error(
    `полигон ${unit.id} (${unit.names.join(" | ")}) подходит к нескольким единицам: ${rows.map((r) => r.pcode).join(", ")}`,
  );
}

function displayName(row: Admin2Row): I18nText {
  const enBare = row.en ?? titleCase(transliterate(row.tg));
  return {
    tg: row.kind === "district" ? `Ноҳияи ${row.tg}` : `Шаҳри ${row.tg}`,
    ru: row.ru,
    en: `${enBare} ${row.kind}`,
  };
}

const started = Date.now();
log(
  `таксономия: ${taxonomy.source.name} (${taxonomy.source.dataDate}, ${taxonomy.source.license})`,
);
log(`геометрия: ${source.title}`);
log(`лицензия геометрии: ${source.license}`);
log(`допуск упрощения: ${tolerance}°${dryRun ? ", режим --dry-run" : ""}`);

const [admin1Fc, admin2Fc] = await Promise.all([
  fetchJson(source.admin1Url, join(cacheDir, "admin1.geojson"), refresh),
  fetchJson(source.admin2Url, join(cacheDir, "admin2.geojson"), refresh),
]);

// admin1 → регионы
const regionGeometry = new Map<RegionCode, Geometry>();
for (const unit of source.admin1(admin1Fc, resolveRegion)) {
  if (!unit.region) {
    throw new Error(
      `admin1 ${unit.id} (${unit.names.join(" | ")}) не сопоставлен ни с одной областью`,
    );
  }
  if (regionGeometry.has(unit.region)) {
    throw new Error(`admin1: область ${unit.region} встречается в источнике дважды`);
  }
  regionGeometry.set(unit.region, unit.geometry);
}
for (const a1 of taxonomy.admin1) {
  if (!regionGeometry.has(a1.code))
    throw new Error(`admin1: в источнике нет полигона для ${a1.code}`);
}
log(`admin1: ${regionGeometry.size} полигонов → ${[...regionGeometry.keys()].join(", ")}`);

// admin2 → районы
const districtGeometry = new Map<string, { unit: SourceUnit; row: Admin2Row }>();
const unmatched: SourceUnit[] = [];
let skipped = 0;
for (const unit of source.admin2(admin2Fc, resolveRegion)) {
  const skipReason = source.skipAdmin2[unit.id];
  if (skipReason) {
    skipped++;
    log(`admin2: пропускаю ${unit.id} — ${skipReason}`);
    continue;
  }
  const row = matchAdmin2(unit);
  if (!row) {
    unmatched.push(unit);
    continue;
  }
  const existing = districtGeometry.get(row.pcode);
  if (existing) {
    throw new Error(
      `полигоны ${existing.unit.id} и ${unit.id} оба сопоставлены с ${row.pcode} (${row.tg}) — уточните aliases`,
    );
  }
  districtGeometry.set(row.pcode, { unit, row });
}
if (unmatched.length > 0) {
  for (const u of unmatched)
    warn(`admin2: не сопоставлен ${u.id}: ${u.names.join(" | ")} (${u.region ?? "?"})`);
  throw new Error(
    `${unmatched.length} полигонов admin2 не сопоставлены — добавьте aliases в ${taxonomyPath}`,
  );
}
const withoutGeometry = taxonomy.admin2.filter((r) => !districtGeometry.has(r.pcode));
log(
  `admin2: ${admin2Fc.features.length} полигонов, пропущено ${skipped}, сопоставлено ${districtGeometry.size} из ${taxonomy.admin2.length} единиц таксономии`,
);
if (withoutGeometry.length > 0) {
  log(
    `без геометрии (${withoutGeometry.length}): ${withoutGeometry.map((r) => `${r.pcode} ${r.tg}${r.kind === "city" ? " (шаҳр)" : ""}`).join(", ")}`,
  );
}

if (dryRun) {
  for (const { unit, row } of [...districtGeometry.values()].sort((a, b) =>
    a.row.pcode.localeCompare(b.row.pcode),
  )) {
    log(
      `  ${row.pcode} ${row.region.padEnd(3)} ${displayName(row).en.padEnd(34)} ← ${unit.id} (${unit.names.join(" | ")})`,
    );
  }
  log(`--dry-run: в базу ничего не записано (${Date.now() - started} мс)`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Запись в PostGIS
// ---------------------------------------------------------------------------
loadRootEnv();
const db = createDb(requireEnv("DATABASE_URL"), { max: 1 });
const sql = db.$client;

/** SQL-выражение: GeoJSON ($geo) → валидный MultiPolygon 4326, упрощённый с допуском $tol. */
function geomExpr(geoParam: number, tolParam: number): string {
  const valid = `ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($${geoParam}::text), 4326)), 3)`;
  const simplified =
    tolerance > 0
      ? `ST_CollectionExtract(ST_MakeValid(ST_SimplifyPreserveTopology(${valid}, $${tolParam}::float8)), 3)`
      : valid;
  return `ST_Multi(${simplified})`;
}

try {
  await sql.begin(async (tx) => {
    for (const a1 of taxonomy.admin1) {
      const geometry = regionGeometry.get(a1.code);
      if (!geometry) throw new Error(`нет геометрии для ${a1.code}`);
      // Названия и порядок — только при вставке (их ведёт seed/админка); geom и centroid обновляются всегда.
      await tx.unsafe(
        `insert into regions (code, name, sort_order, geom, centroid)
         select $1, $2::jsonb, $3::smallint, g,
                case when ST_Within(ST_Centroid(g), g) then ST_Centroid(g) else ST_PointOnSurface(g) end
         from (select ${geomExpr(4, 5)} as g) as s
         on conflict (code) do update
           set geom = excluded.geom, centroid = excluded.centroid, updated_at = now()`,
        [a1.code, JSON.stringify(a1.name), a1.sortOrder, JSON.stringify(geometry), tolerance],
      );
    }

    const regionRows = await tx<{ id: number; code: string }[]>`select id, code from regions`;
    const regionId = new Map(regionRows.map((r) => [r.code, r.id]));

    for (const row of taxonomy.admin2) {
      const rid = regionId.get(row.region);
      if (rid === undefined) throw new Error(`regions: нет записи с кодом ${row.region}`);
      const match = districtGeometry.get(row.pcode);
      const geomSql = match ? geomExpr(4, 5) : "null::geometry(MultiPolygon, 4326)";
      await tx.unsafe(
        `insert into districts (region_id, code, name, geom)
         values ($1, $2, $3::jsonb, ${geomSql})
         on conflict (code) do update
           set region_id = excluded.region_id, name = excluded.name, geom = excluded.geom, updated_at = now()`,
        match
          ? [
              rid,
              row.pcode,
              JSON.stringify(displayName(row)),
              JSON.stringify(match.unit.geometry),
              tolerance,
            ]
          : [rid, row.pcode, JSON.stringify(displayName(row))],
      );
    }
  });
  log(
    `записано: regions ${taxonomy.admin1.length} (upsert), districts ${taxonomy.admin2.length} (upsert, с геометрией ${districtGeometry.size})`,
  );

  // -------------------------------------------------------------------------
  // Проверки
  // -------------------------------------------------------------------------
  const [regionStats] = await sql<{ total: number; with_geom: number; invalid: number }[]>`
    select count(*)::int as total, count(geom)::int as with_geom,
           count(*) filter (where geom is not null and not ST_IsValid(geom))::int as invalid
    from regions`;
  const [districtStats] = await sql<
    { total: number; with_geom: number; invalid: number; points: number }[]
  >`
    select count(*)::int as total, count(geom)::int as with_geom,
           count(*) filter (where geom is not null and not ST_IsValid(geom))::int as invalid,
           coalesce(sum(ST_NPoints(geom)), 0)::int as points
    from districts`;
  const outside = await sql<{ code: string; name: string; region: string }[]>`
    select d.code, d.name->>'ru' as name, r.code as region
    from districts d join regions r on r.id = d.region_id
    where d.geom is not null and r.geom is not null
      and not ST_Intersects(ST_PointOnSurface(d.geom), r.geom)
    order by d.code`;
  const stale = await sql<{ code: string; name: string }[]>`
    select code, name->>'ru' as name from districts
    where code <> all(${taxonomy.admin2.map((r) => r.pcode)}::text[])
    order by code`;
  const areas = await sql<
    { code: string; km2: number; districts: number; lon: number; lat: number }[]
  >`
    select r.code, round(ST_Area(r.geom::geography) / 1e6)::int as km2,
           (select count(*) from districts d where d.region_id = r.id)::int as districts,
           round(ST_X(r.centroid)::numeric, 3)::float8 as lon, round(ST_Y(r.centroid)::numeric, 3)::float8 as lat
    from regions r order by r.sort_order`;

  log(
    `проверка: regions с geom = ${regionStats?.with_geom ?? 0} из ${regionStats?.total ?? 0} (невалидных ${regionStats?.invalid ?? 0}); districts = ${districtStats?.total ?? 0}, с geom ${districtStats?.with_geom ?? 0} (невалидных ${districtStats?.invalid ?? 0}, вершин ${districtStats?.points ?? 0})`,
  );
  for (const a of areas) {
    log(
      `  ${a.code.padEnd(3)} ${String(a.km2).padStart(6)} км²  районов/городов: ${String(a.districts).padStart(2)}  centroid ${a.lon}, ${a.lat}`,
    );
  }
  if (outside.length > 0) {
    for (const o of outside)
      warn(`район ${o.code} «${o.name}» лежит вне полигона области ${o.region}`);
  }
  if (stale.length > 0) {
    warn(
      `в districts есть записи вне текущей таксономии (не удаляются автоматически): ${stale.map((s) => `${s.code} «${s.name}»`).join(", ")}`,
    );
  }
  if ((regionStats?.with_geom ?? 0) !== taxonomy.admin1.length) {
    throw new Error(
      `ожидалось ${taxonomy.admin1.length} областей с геометрией, получено ${regionStats?.with_geom ?? 0}`,
    );
  }
  log(`готово за ${Date.now() - started} мс`);
} finally {
  await sql.end();
}
