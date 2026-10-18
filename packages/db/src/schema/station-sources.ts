import type { FeedMapping } from "@meteo/core";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { timestamps } from "./_shared";
import { stations } from "./stations";

/** Тип источника pull‑адаптера (задача worker'а station-pull). */
export const stationSourceKind = pgEnum("station_source_kind", ["sftp", "ftp", "ftps", "http"]);
export type StationSourceKind = (typeof stationSourceKind.enumValues)[number];

export const STATION_SOURCE_STATUSES = ["never", "ok", "failed", "disabled"] as const;
export type StationSourceStatus = (typeof STATION_SOURCE_STATUSES)[number];

/** Реестр обработанных файлов источника: имя → отметка (mtime/size/ETag) и итог разбора. */
export interface StationSourceFileState {
  mtime: string | null;
  size: number | null;
  etag?: string | null;
  at: string;
  rows: number;
  accepted: number;
  rejected: number;
}

/** Сводка последнего запуска по источнику (карточка станции). */
export interface StationSourceRunSummary {
  at: string;
  files: number;
  received: number;
  accepted: number;
  rejected: number;
  /** Первые ошибки разбора/приёма: файл, строка, причина. */
  errors: Array<{ file: string; row?: number; message: string }>;
}

/**
 * Источники данных станций pull‑типа: worker каждые 10 минут забирает новые файлы экспорта
 * по SFTP/FTP(S) или HTTP(S), разбирает их маппингом (`FeedMapping`, тот же, что у агента)
 * и записывает через `ingestMeasurements`. Пароль/ключ хранятся зашифрованными
 * (`@meteo/core/secret-box`) или ссылкой `env:ИМЯ` на переменную окружения worker'а.
 */
export const stationSources = pgTable(
  "station_sources",
  {
    id: serial("id").primaryKey(),
    stationId: integer("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    kind: stationSourceKind("kind").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    label: varchar("label", { length: 64 }),
    host: varchar("host", { length: 255 }).notNull().default(""),
    port: integer("port"),
    username: varchar("username", { length: 128 }),
    /** Пароль (sftp/ftp/http basic) или bearer‑токен (http без username): enc:v1:… или env:ИМЯ. */
    secret: text("secret"),
    /** Приватный ключ SSH в PEM (sftp): enc:v1:… или env:ИМЯ. */
    privateKey: text("private_key"),
    /** Отпечаток ключа хоста SFTP (SHA256:… из ssh-keygen -lf); пусто — без проверки. */
    hostFingerprint: varchar("host_fingerprint", { length: 128 }),
    /** Каталог на сервере (sftp/ftp) или полный URL файла (http). */
    path: text("path").notNull().default(""),
    /** Маска файлов экспорта (*.csv, DU-01_*.txt); для http не используется. */
    filePattern: varchar("file_pattern", { length: 255 }).notNull().default("*.csv"),
    mapping: jsonb("mapping").$type<FeedMapping>().notNull(),
    /** Через сколько минут без принятых данных уведомить администраторов. */
    staleAfterMin: integer("stale_after_min").notNull().default(180),
    status: varchar("status", { length: 16 })
      .$type<StationSourceStatus>()
      .notNull()
      .default("never"),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    /** Последний запуск, принявший хотя бы одно значение. */
    lastDataAt: timestamp("last_data_at", { withTimezone: true }),
    lastError: text("last_error"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    files: jsonb("files").$type<Record<string, StationSourceFileState>>().notNull().default({}),
    lastSummary: jsonb("last_summary").$type<StationSourceRunSummary>(),
    /** Когда отправлено письмо о длительном отсутствии данных (null — не отправлялось). */
    alertedAt: timestamp("alerted_at", { withTimezone: true }),
    createdBy: text("created_by"),
    updatedBy: text("updated_by"),
    ...timestamps,
  },
  (t) => [index("station_sources_station_id_idx").on(t.stationId)],
);
