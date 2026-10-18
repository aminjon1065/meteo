/**
 * OpenAPI 3.1 публичного API из Zod‑схем (`schemas.ts`). Документ строится для языка интерфейса:
 * заголовки и описания эндпоинтов берутся из messages (apiDocs.endpoints.*), описания полей —
 * из схем. Отдаётся на /api/v1/openapi.json и рендерится на странице /data/api.
 */
import { z } from "zod";
import {
  AlertsGeoJsonSchema,
  AlertsResponseSchema,
  alertsQuery,
  ErrorSchema,
  ExceedancesResponseSchema,
  ForecastResponseSchema,
  forecastQuery,
  IndexCurrentResponseSchema,
  indexQuery,
  MeasurementsResponseSchema,
  measurementsQuery,
  NewsResponseSchema,
  newsQuery,
  newsRssQuery,
  RegionsResponseSchema,
  SilamLayersResponseSchema,
  SilamPointResponseSchema,
  StationsResponseSchema,
} from "./schemas";

export const API_VERSION = "1.0.0";

export type JsonSchema = Record<string, unknown>;

export interface ApiParam {
  name: string;
  in: "query" | "path";
  required: boolean;
  schema: JsonSchema;
  description?: string;
}

export interface ApiResponse {
  status: number;
  contentType: string;
  schema?: JsonSchema;
  descriptionKey: string;
}

export interface ApiEndpoint {
  id: string;
  method: "GET";
  path: string;
  tag: string;
  summary: string;
  description: string;
  params: ApiParam[];
  responses: ApiResponse[];
  /** Пример запроса для документации. */
  example: string;
  cache?: string;
}

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export function toJsonSchema(schema: z.ZodType): JsonSchema {
  const json = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "output",
    unrepresentable: "any",
  }) as JsonSchema;
  delete json.$schema;
  return json;
}

/** Параметры запроса из Zod‑объекта: имя, обязательность, JSON Schema и описание. */
function queryParams(schema: z.ZodObject, t: Translate, endpointId: string): ApiParam[] {
  const json = toJsonSchema(schema);
  const props = (json.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((json.required as string[] | undefined) ?? []);
  return Object.entries(props).map(([name, prop]) => {
    const { description, ...rest } = prop;
    const key = `endpoints.${endpointId}.params.${name}`;
    const localized = safeT(t, key);
    return {
      name,
      in: "query",
      required: required.has(name) && rest.default === undefined,
      schema: rest,
      description: localized ?? (typeof description === "string" ? description : undefined),
    };
  });
}

function pathParam(name: string, t: Translate, endpointId: string): ApiParam {
  return {
    name,
    in: "path",
    required: true,
    schema: { type: "string" },
    description: safeT(t, `endpoints.${endpointId}.params.${name}`) ?? undefined,
  };
}

/** next-intl бросает на отсутствующем ключе; в документе параметры без перевода — без описания. */
function safeT(t: Translate, key: string): string | null {
  try {
    const v = t(key);
    return v && !v.startsWith("apiDocs.") ? v : null;
  } catch {
    return null;
  }
}

const JSON_TYPE = "application/json";

export function listEndpoints(t: Translate): ApiEndpoint[] {
  const ok = (schema: z.ZodType, contentType = JSON_TYPE): ApiResponse => ({
    status: 200,
    contentType,
    schema: toJsonSchema(schema),
    descriptionKey: "responses.ok",
  });
  const notFound: ApiResponse = {
    status: 404,
    contentType: JSON_TYPE,
    schema: toJsonSchema(ErrorSchema),
    descriptionKey: "responses.notFound",
  };
  const badRequest: ApiResponse = {
    status: 400,
    contentType: JSON_TYPE,
    schema: toJsonSchema(ErrorSchema),
    descriptionKey: "responses.badRequest",
  };
  const ep = (
    id: string,
    path: string,
    tag: string,
    params: ApiParam[],
    responses: ApiResponse[],
    example: string,
    cache?: string,
  ): ApiEndpoint => ({
    id,
    method: "GET",
    path,
    tag,
    summary: t(`endpoints.${id}.summary`),
    description: t(`endpoints.${id}.description`),
    params,
    responses,
    example,
    cache,
  });

  return [
    ep(
      "stations",
      "/api/v1/stations",
      "air",
      [],
      [ok(StationsResponseSchema)],
      "/api/v1/stations",
      "60 s",
    ),
    ep(
      "stationMeasurements",
      "/api/v1/stations/{slug}/measurements",
      "air",
      [
        pathParam("slug", t, "stationMeasurements"),
        ...queryParams(measurementsQuery, t, "stationMeasurements"),
      ],
      [
        ok(MeasurementsResponseSchema),
        { status: 200, contentType: "text/csv", descriptionKey: "responses.csv" },
        badRequest,
        notFound,
      ],
      "/api/v1/stations/dushanbe-centre/measurements?range=7d&pollutant=PM25",
      "60 s",
    ),
    ep(
      "indexCurrent",
      "/api/v1/index/current",
      "air",
      queryParams(indexQuery, t, "indexCurrent"),
      [ok(IndexCurrentResponseSchema), notFound],
      "/api/v1/index/current",
      "60 s",
    ),
    ep(
      "exceedances",
      "/api/v1/exceedances",
      "air",
      [],
      [ok(ExceedancesResponseSchema)],
      "/api/v1/exceedances",
      "60 s",
    ),
    ep(
      "forecast",
      "/api/v1/forecast/{slug}",
      "weather",
      [pathParam("slug", t, "forecast"), ...queryParams(forecastQuery, t, "forecast")],
      [ok(ForecastResponseSchema), notFound],
      "/api/v1/forecast/dushanbe?hours=48&days=7",
      "300 s",
    ),
    ep(
      "silamPoint",
      "/api/v1/silam/{slug}",
      "weather",
      [pathParam("slug", t, "silamPoint")],
      [ok(SilamPointResponseSchema), notFound],
      "/api/v1/silam/dushanbe",
      "600 s",
    ),
    ep(
      "silamLayers",
      "/api/v1/silam/layers",
      "weather",
      [],
      [ok(SilamLayersResponseSchema)],
      "/api/v1/silam/layers",
      "600 s",
    ),
    ep(
      "alerts",
      "/api/v1/alerts",
      "warnings",
      queryParams(alertsQuery, t, "alerts"),
      [
        ok(AlertsResponseSchema),
        { ...ok(AlertsGeoJsonSchema, "application/geo+json"), descriptionKey: "responses.geojson" },
      ],
      "/api/v1/alerts?active=1&lang=ru",
      "60 s",
    ),
    ep(
      "alertXml",
      "/api/v1/alerts/{id}/xml",
      "warnings",
      [pathParam("id", t, "alertXml")],
      [
        { status: 200, contentType: "application/cap+xml", descriptionKey: "responses.capXml" },
        notFound,
      ],
      "/api/v1/alerts/1/xml",
      "300 s",
    ),
    ep(
      "news",
      "/api/v1/news",
      "content",
      queryParams(newsQuery, t, "news"),
      [ok(NewsResponseSchema)],
      "/api/v1/news?locale=ru&pageSize=5",
      "300 s",
    ),
    ep(
      "newsRss",
      "/api/v1/news/rss.xml",
      "content",
      queryParams(newsRssQuery, t, "newsRss"),
      [{ status: 200, contentType: "application/rss+xml", descriptionKey: "responses.rss" }],
      "/api/v1/news/rss.xml?locale=tg",
      "300 s",
    ),
    ep(
      "regions",
      "/api/v1/regions",
      "geo",
      [],
      [ok(RegionsResponseSchema)],
      "/api/v1/regions",
      "3600 s",
    ),
  ];
}

export function buildOpenApi(opts: { baseUrl: string; locale: string; t: Translate }) {
  const endpoints = listEndpoints(opts.t);
  const tags = [...new Set(endpoints.map((e) => e.tag))].map((tag) => ({
    name: tag,
    description: opts.t(`tags.${tag}`),
  }));
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of endpoints) {
    paths[e.path] = {
      get: {
        operationId: e.id,
        tags: [e.tag],
        summary: e.summary,
        description: e.description,
        parameters: e.params.map((p) => ({
          name: p.name,
          in: p.in,
          required: p.required,
          schema: p.schema,
          ...(p.description ? { description: p.description } : {}),
        })),
        responses: Object.fromEntries(
          groupResponses(e.responses).map(([status, list]) => [
            String(status),
            {
              description: opts.t(list[0]?.descriptionKey ?? "responses.ok"),
              content: Object.fromEntries(
                list.map((r) => [r.contentType, r.schema ? { schema: r.schema } : {}]),
              ),
            },
          ]),
        ),
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: opts.t("info.title"),
      version: API_VERSION,
      description: opts.t("info.description"),
      contact: { url: `${opts.baseUrl}/${opts.locale === "tg" ? "" : `${opts.locale}/`}about` },
      license: {
        name: opts.t("info.license"),
        url: "https://creativecommons.org/licenses/by/4.0/",
      },
    },
    servers: [{ url: opts.baseUrl }],
    tags,
    paths,
    components: { schemas: { Error: toJsonSchema(ErrorSchema) } },
    "x-cache": Object.fromEntries(endpoints.filter((e) => e.cache).map((e) => [e.path, e.cache])),
  };
}

function groupResponses(list: ApiResponse[]): Array<[number, ApiResponse[]]> {
  const map = new Map<number, ApiResponse[]>();
  for (const r of list) map.set(r.status, [...(map.get(r.status) ?? []), r]);
  return [...map.entries()].sort(([a], [b]) => a - b);
}
