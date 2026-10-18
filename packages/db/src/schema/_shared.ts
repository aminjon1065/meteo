import type { I18nText } from "@meteo/i18n";
import { sql } from "drizzle-orm";
import { customType, jsonb, timestamp } from "drizzle-orm/pg-core";

/** Локализованная строка {"tg","ru","en"} в jsonb. */
export const i18nText = (name: string) => jsonb(name).$type<I18nText>();

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

export interface GeoJsonMultiPolygon {
  type: "MultiPolygon";
  coordinates: number[][][][];
}

/**
 * PostGIS MultiPolygon (SRID 4326). Запись — через GeoJSON, чтение по умолчанию
 * возвращает WKB‑hex; для GeoJSON в выборках используйте ST_AsGeoJSON(geom).
 */
export const multiPolygon = customType<{
  data: GeoJsonMultiPolygon;
  driverData: string;
  config: undefined;
}>({
  dataType() {
    return "geometry(MultiPolygon, 4326)";
  },
  toDriver(value) {
    return sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(value)}), 4326)`;
  },
  fromDriver(value) {
    // WKB‑hex: парсинг полигонов делаем на стороне SQL (ST_AsGeoJSON), здесь — заглушка.
    return { type: "MultiPolygon", coordinates: [], _wkb: value } as unknown as GeoJsonMultiPolygon;
  },
});
