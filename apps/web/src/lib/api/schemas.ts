/**
 * Zod‑схемы публичного API (/api/v1) — единый источник для OpenAPI 3.1 (`openapi.ts`)
 * и документации на /data/api. Описания полей — на английском (язык спецификации),
 * заголовки и пояснения эндпоинтов локализуются через messages (apiDocs.*).
 */
import { z } from "zod";

export const I18nTextSchema = z
  .object({
    tg: z.string().optional(),
    ru: z.string().optional(),
    en: z.string().optional(),
  })
  .describe("Localized text: Tajik (tg), Russian (ru), English (en)");

const isoDateTime = z.iso.datetime({ offset: true }).describe("ISO 8601 timestamp (UTC)");
const nullableIso = isoDateTime.nullable();
const level = z.int().min(0).max(5).describe("Air quality level 1–5; 0 — no data");

export const ErrorSchema = z.object({ error: z.string() }).describe("Error response");

const pointGeometry = z.object({
  type: z.literal("Point"),
  coordinates: z.tuple([z.number().describe("longitude"), z.number().describe("latitude")]),
});

export const StationFeatureSchema = z.object({
  type: z.literal("Feature"),
  id: z.int(),
  geometry: pointGeometry,
  properties: z.object({
    id: z.int(),
    slug: z.string(),
    code: z.string().describe("Station code, e.g. DU-01"),
    name: I18nTextSchema,
    kind: z.enum(["air", "meteo", "combined"]),
    status: z.enum(["active", "suspended", "decommissioned"]),
    region: I18nTextSchema.nullable(),
    level,
    indexValue: z.number().nullable().describe("Continuous index value (level + fraction)"),
    indexTime: nullableIso.describe("Time of the index value"),
  }),
});

export const StationsResponseSchema = z
  .object({
    type: z.literal("FeatureCollection"),
    features: z.array(StationFeatureSchema),
  })
  .describe("Public monitoring stations as GeoJSON FeatureCollection");

export const measurementsQuery = z.object({
  range: z.enum(["24h", "7d", "30d", "1y"]).default("24h"),
  pollutant: z.string().optional().describe("Pollutant code: PM25, PM10, NO2, SO2, CO, O3"),
  format: z.enum(["json", "csv"]).default("json"),
});

export const MeasurementsResponseSchema = z
  .object({
    station: z.object({ id: z.int(), slug: z.string(), code: z.string(), name: I18nTextSchema }),
    range: z.enum(["24h", "7d", "30d", "1y"]),
    from: isoDateTime,
    to: isoDateTime,
    aggregation: z.enum(["hour", "day"]).describe("hour for 24h/7d, day (local time) for 30d/1y"),
    timezone: z.literal("Asia/Dushanbe"),
    series: z.array(
      z.object({
        pollutant: z.object({
          id: z.int(),
          code: z.string(),
          shortName: z.string(),
          unit: z.string().describe("µg/m³ or mg/m³ (CO)"),
          decimals: z.int(),
        }),
        points: z.array(
          z.object({
            t: isoDateTime.describe("Start of the hour/day"),
            v: z.number().nullable().describe("Mean of valid measurements"),
            min: z.number().nullable(),
            max: z.number().nullable(),
            n: z.int().describe("Number of measurements in the bin"),
          }),
        ),
      }),
    ),
  })
  .describe("Hourly or daily series of valid measurements for a station");

export const indexQuery = z.object({
  scale: z
    .string()
    .optional()
    .describe("Scale code (NATIONAL_OPERATIONAL by default; also WHO_24H, IZA)"),
});

export const IndexCurrentResponseSchema = z
  .object({
    scale: z.object({
      code: z.string(),
      kind: z.enum(["breakpoints", "ratio_to_limit", "iza"]),
      levels: z.array(
        z.object({
          level: z.int(),
          color: z.string().describe("Hex colour"),
          label: I18nTextSchema,
          lo: z.number().optional(),
          hi: z.number().nullable().optional(),
        }),
      ),
    }),
    generatedAt: isoDateTime,
    stations: z.array(
      z.object({
        id: z.int(),
        slug: z.string(),
        code: z.string(),
        name: I18nTextSchema,
        level,
        value: z.number().nullable(),
        time: nullableIso,
        stale: z.boolean().describe("Index older than 6 hours"),
        dominantPollutant: z
          .string()
          .nullable()
          .describe("Pollutant code with the worst sub-index"),
        subIndices: z.record(
          z.string().describe("Pollutant code"),
          z.object({ value: z.number(), level: z.int(), index: z.number() }),
        ),
      }),
    ),
  })
  .describe("Current index of all public stations on the selected scale");

export const ExceedancesResponseSchema = z
  .object({
    generatedAt: isoDateTime,
    events: z.array(
      z.object({
        id: z.int(),
        startedAt: isoDateTime,
        station: z.object({ id: z.int(), slug: z.string(), name: I18nTextSchema }),
        rule: z.string(),
        kind: z.enum(["pollutant", "index"]),
        pollutant: z.string().nullable(),
        unit: z.string().nullable(),
        value: z.number().nullable(),
        threshold: z.number(),
        level: z.int().nullable(),
      }),
    ),
  })
  .describe("Active threshold exceedances (portal channel)");

export const forecastQuery = z.object({
  hours: z.int().min(1).max(240).default(72),
  days: z.int().min(1).max(16).default(10),
});

const forecastParams = {
  t: z.number().nullable().optional().describe("Air temperature, °C"),
  ws: z.number().nullable().optional().describe("Wind speed, m/s"),
  wd: z.number().nullable().optional().describe("Wind direction, degrees"),
  gust: z.number().nullable().optional().describe("Wind gust, m/s"),
  rh: z.number().nullable().optional().describe("Relative humidity, %"),
  p: z.number().nullable().optional().describe("Pressure, hPa"),
  dew: z.number().nullable().optional().describe("Dew point, °C"),
  precip: z.number().nullable().optional().describe("Precipitation, mm/h"),
  cloud: z.number().nullable().optional().describe("Total cloud cover, %"),
  symbol: z.int().nullable().optional().describe("FMI SmartSymbol code (1xx — night variant)"),
};

export const ForecastResponseSchema = z
  .object({
    location: z.object({
      slug: z.string(),
      name: I18nTextSchema,
      lat: z.number(),
      lon: z.number(),
      region: I18nTextSchema.nullable(),
    }),
    producer: z.string().nullable().describe("SmartMet producer, e.g. ecmwf"),
    originTime: nullableIso.describe("Model run time"),
    fetchedAt: nullableIso,
    timeZone: z.literal("Asia/Dushanbe"),
    hourly: z.array(z.object({ time: isoDateTime, ...forecastParams })),
    daily: z.array(
      z.object({
        date: isoDateTime.describe("Local midnight (UTC+5) of the day"),
        tmax: z.number().nullable().optional(),
        tmin: z.number().nullable().optional(),
        precipSum: z.number().nullable().optional().describe("Daily precipitation, mm"),
        ws: z.number().nullable().optional().describe("Max wind speed, m/s"),
        cloud: z.number().nullable().optional(),
        symbol: z.int().nullable().optional(),
      }),
    ),
  })
  .describe("SmartMet weather forecast for a location: hourly series and daily aggregates");

export const SilamPointResponseSchema = z
  .object({
    location: z.object({
      slug: z.string(),
      name: I18nTextSchema,
      lat: z.number(),
      lon: z.number(),
    }),
    run: z.object({ originTime: isoDateTime, fetchedAt: isoDateTime }).nullable(),
    units: z.record(z.string(), z.string()).describe("Unit per pollutant code"),
    hourly: z
      .record(
        z.string().describe("Pollutant code"),
        z.array(
          z.tuple([
            isoDateTime.describe("time"),
            z.number().describe("concentration"),
            z.int().describe("level"),
          ]),
        ),
      )
      .describe("Hourly [time, value, level] per pollutant"),
    days: z.array(
      z.object({
        date: z.string().describe("YYYY-MM-DD, local time"),
        level,
        dominantPollutant: z.string().nullable(),
        means: z.record(z.string(), z.number()).describe("Daily mean per pollutant code"),
      }),
    ),
  })
  .describe("SILAM point forecast (hourly concentrations and daily summary)");

export const SilamLayersResponseSchema = z
  .object({
    run: z
      .object({
        originTime: isoDateTime,
        fetchedAt: isoDateTime,
        hours: z.int(),
        bounds: z
          .object({ west: z.number(), south: z.number(), east: z.number(), north: z.number() })
          .nullable()
          .describe("Grid bounds in degrees for image placement"),
      })
      .nullable(),
    pollutants: z.array(
      z.object({
        code: z.string(),
        frames: z.array(
          z.object({
            time: isoDateTime,
            url: z.string().describe("Relative URL of the PNG layer"),
            max: z.number().nullable().describe("Maximum concentration in the domain"),
          }),
        ),
      }),
    ),
  })
  .describe("Catalogue of SILAM raster layers of the latest run");

export const alertsQuery = z.object({
  active: z.enum(["1"]).optional().describe("Only alerts active now"),
  region: z.string().optional().describe("Warning region code, e.g. DU, SU, KT, GB, RRP"),
  lang: z.enum(["tg", "ru", "en"]).default("tg"),
  days: z.int().min(1).max(14).default(7).describe("Horizon in days"),
  format: z.enum(["json", "geojson"]).default("json"),
});

export const AlertSchema = z.object({
  id: z.int(),
  identifier: z.string().describe("CAP identifier"),
  sent: isoDateTime,
  msgType: z.enum(["Alert", "Update", "Cancel", "Ack", "Error"]),
  language: z.string(),
  event: z.string(),
  headline: z.string(),
  description: z.string().nullable(),
  instruction: z.string().nullable(),
  severity: z.enum(["Extreme", "Severe", "Moderate", "Minor", "Unknown"]),
  color: z.enum(["red", "orange", "yellow", "none"]),
  colorHex: z.string(),
  urgency: z.string(),
  certainty: z.string(),
  effective: nullableIso,
  onset: nullableIso,
  expires: nullableIso,
  start: isoDateTime,
  end: nullableIso,
  active: z.boolean(),
  upcoming: z.boolean(),
  regions: z.array(z.object({ code: z.string(), name: I18nTextSchema })),
  areas: z.array(z.string()).describe("areaDesc values"),
  web: z.string().nullable(),
  xml: z.string().describe("URL of the original CAP XML"),
});

export const AlertsResponseSchema = z
  .object({
    generatedAt: isoDateTime,
    lang: z.enum(["tg", "ru", "en"]),
    count: z.int(),
    alerts: z.array(AlertSchema),
  })
  .describe("CAP warnings, normalized (one info block per language with fallback)");

export const AlertsGeoJsonSchema = z
  .object({
    type: z.literal("FeatureCollection"),
    generatedAt: isoDateTime,
    features: z.array(
      z.object({
        type: z.literal("Feature"),
        id: z.string(),
        geometry: z.object({ type: z.string(), coordinates: z.array(z.any()) }),
        properties: z.object({
          id: z.int(),
          identifier: z.string(),
          event: z.string(),
          headline: z.string(),
          severity: z.string(),
          level: z.int(),
          color: z.string(),
          start: isoDateTime,
          end: nullableIso,
          active: z.boolean(),
          region: z.string().nullable(),
          areaDesc: z.string(),
          href: z.string(),
        }),
      }),
    ),
  })
  .describe("CAP warnings as GeoJSON polygons for maps");

export const newsQuery = z.object({
  locale: z.enum(["tg", "ru", "en"]).default("tg"),
  page: z.int().min(1).default(1),
  pageSize: z.int().min(1).max(50).default(12),
  category: z.string().optional().describe("Category slug"),
});

export const NewsResponseSchema = z
  .object({
    locale: z.enum(["tg", "ru", "en"]),
    page: z.int(),
    pageSize: z.int(),
    total: z.int(),
    items: z.array(
      z.object({
        id: z.int(),
        slug: z.string(),
        title: z.string(),
        excerpt: z.string(),
        publishedAt: nullableIso,
        updatedAt: isoDateTime,
        pinned: z.boolean(),
        category: z.object({ slug: z.string(), name: z.string() }).nullable(),
        cover: z.string().nullable().describe("Absolute URL of the cover image"),
        url: z.string().describe("Absolute URL of the article"),
      }),
    ),
  })
  .describe("Published news in the requested language");

const BoundaryPropertiesSchema = z.object({
  id: z.int(),
  code: z.string(),
  name: I18nTextSchema,
  stationsCount: z.int().describe("Public stations located inside the unit"),
  level: z
    .int()
    .min(0)
    .max(5)
    .describe("Worst current index level among the unit's stations; 0 — no data or stale"),
});

const MultiPolygonSchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.any()),
});

export const RegionsResponseSchema = z
  .object({
    type: z.literal("FeatureCollection"),
    features: z.array(
      z.object({
        type: z.literal("Feature"),
        id: z.int(),
        geometry: MultiPolygonSchema,
        properties: BoundaryPropertiesSchema.extend({
          sortOrder: z.int(),
          centroid: z.tuple([z.number(), z.number()]).nullable(),
        }),
      }),
    ),
  })
  .describe(
    "Administrative regions (oblasts, Dushanbe, RRP) as simplified GeoJSON (ST_SimplifyPreserveTopology 0.002°) with station counts and the current index level",
  );

export const DistrictsResponseSchema = z
  .object({
    type: z.literal("FeatureCollection"),
    features: z.array(
      z.object({
        type: z.literal("Feature"),
        id: z.int(),
        geometry: MultiPolygonSchema,
        properties: BoundaryPropertiesSchema.extend({
          regionId: z.int().describe("Parent region id"),
          regionCode: z.string().describe("Parent region code (DU, RRP, SU, KT, GB)"),
        }),
      }),
    ),
  })
  .describe(
    "Districts and cities of regional subordination as simplified GeoJSON with station counts and the current index level",
  );

export const newsRssQuery = z.object({ locale: z.enum(["tg", "ru", "en"]).default("tg") });

// ---------------------------------------------------------------------------
// Приём данных станций: POST /api/v1/ingest/{code} (ключ станции в Authorization: Bearer)
// ---------------------------------------------------------------------------

export const IngestRecordSchema = z
  .object({
    time: z
      .union([z.string().max(40), z.number()])
      .describe(
        "Measurement time: ISO 8601 with offset (2026-10-18T07:00:00Z), local Asia/Dushanbe time without offset (2026-10-18 12:00, 18.10.2026 12:00) or Unix epoch seconds",
      ),
    pollutant: z
      .string()
      .max(64)
      .describe(
        "Pollutant code (PM25, PM10, NO2, SO2, CO, O3) or a vendor synonym (pm2.5, Ozone, NO₂ …)",
      ),
    value: z
      .union([z.number(), z.string().max(32), z.null()])
      .describe(
        "Concentration: number, numeric string with comma decimal, '<5' (below detection limit) or null with flag=missing",
      ),
    unit: z
      .string()
      .max(16)
      .nullable()
      .optional()
      .describe(
        "Input unit: µg/m³, mg/m³, ppb or ppm; default — the station's input unit for the pollutant",
      ),
    flag: z
      .union([z.string().max(32), z.int().min(0).max(5)])
      .nullable()
      .optional()
      .describe(
        "Vendor quality flag: valid, suspect, invalid, missing (or QC code 0–5); unknown values are treated as valid",
      ),
    averagingMin: z
      .int()
      .min(1)
      .max(1440)
      .nullable()
      .optional()
      .describe(
        "Averaging period, minutes; default 60 for continuous stations and 20 for discrete samples",
      ),
  })
  .describe("One measurement of the station");

const ingestRecords = z
  .array(IngestRecordSchema)
  .min(1)
  .max(1000)
  .describe("Up to 1000 measurements per request");

export const IngestRequestSchema = z
  .union([ingestRecords, z.object({ measurements: ingestRecords })])
  .describe("JSON array of measurements (or an object with a measurements array)");

export const IngestResponseSchema = z
  .object({
    station: z.object({ id: z.int(), code: z.string(), slug: z.string() }),
    received: z.int().describe("Records in the request"),
    accepted: z.int().describe("Records stored (distinct time/pollutant/averaging keys)"),
    rejected: z.int().describe("Records rejected; see errors"),
    inserted: z.int().describe("New rows"),
    updated: z.int().describe("Existing rows overwritten (idempotent re-sends)"),
    skippedLocked: z.int().describe("Rows kept as decided by an operator (qc_locked)"),
    invalidRange: z
      .int()
      .describe("Accepted values outside the QC range, stored with flag invalid"),
    duplicates: z.int().describe("Records superseded by a later record with the same key"),
    from: z.iso.datetime({ offset: true }).nullable(),
    to: z.iso.datetime({ offset: true }).nullable(),
    pollutants: z.array(z.string()).describe("Pollutant codes of accepted records"),
    errors: z
      .array(
        z.object({
          index: z.int().describe("Index of the record in the request array"),
          message: z
            .string()
            .describe(
              "Reason: time, futureTime, tooOld, unknownPollutant:X, pollutantNotConfigured:X, emptyValue, value:X, unit:X, unitConversion:X, averagingMin:X, duplicate",
            ),
        }),
      )
      .describe("Per-record reasons for rejected and superseded records"),
  })
  .describe("Ingest result; HTTP 200 when at least one record was accepted, 422 when none");

export const IngestErrorSchema = z
  .object({
    error: z
      .string()
      .describe(
        "unauthorized | station_inactive | invalid_json | validation | payload_too_large | rate_limited",
      ),
    message: z.string().optional(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .describe("Error response");
