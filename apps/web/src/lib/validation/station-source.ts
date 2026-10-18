import { validateFeedMapping } from "@meteo/core";
import { z } from "zod";
import { emptyToNull } from "./common";

export const stationSourceKinds = ["sftp", "ftp", "ftps", "http"] as const;
export type StationSourceKindInput = (typeof stationSourceKinds)[number];

/** Форма источника pull‑типа в карточке станции; маппинг приходит текстом JSON. */
export const stationSourceInput = z
  .object({
    id: z.preprocess(emptyToNull, z.coerce.number().int().positive().nullable()).default(null),
    kind: z.enum(stationSourceKinds),
    enabled: z.boolean().default(true),
    label: z.string().trim().max(64, "max").optional().default(""),
    host: z.string().trim().max(255, "max").optional().default(""),
    port: z
      .preprocess(
        emptyToNull,
        z.coerce.number().int().min(1, "range").max(65535, "range").nullable(),
      )
      .default(null),
    username: z.string().trim().max(128, "max").optional().default(""),
    /** Пустая строка — оставить прежний пароль; "-" — удалить. */
    password: z.string().max(4096, "max").optional().default(""),
    privateKey: z.string().max(16384, "max").optional().default(""),
    hostFingerprint: z.string().trim().max(128, "max").optional().default(""),
    path: z.string().trim().max(2048, "max").optional().default(""),
    filePattern: z.string().trim().max(255, "max").optional().default("*.csv"),
    mappingJson: z.string().max(65536, "max"),
    staleAfterMin: z.coerce.number().int().min(5, "range").max(43200, "range").default(180),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "http") {
      if (!/^https?:\/\/\S+$/i.test(v.path))
        ctx.addIssue({ code: "custom", path: ["path"], message: "url" });
    } else {
      if (!v.host) ctx.addIssue({ code: "custom", path: ["host"], message: "required" });
      if (!v.path) ctx.addIssue({ code: "custom", path: ["path"], message: "required" });
      if (!v.filePattern)
        ctx.addIssue({ code: "custom", path: ["filePattern"], message: "required" });
    }
    let mapping: unknown;
    try {
      mapping = JSON.parse(v.mappingJson);
    } catch {
      ctx.addIssue({ code: "custom", path: ["mappingJson"], message: "json" });
      return;
    }
    const problems = validateFeedMapping(mapping);
    if (problems.length)
      ctx.addIssue({ code: "custom", path: ["mappingJson"], message: `mapping:${problems[0]}` });
  });

export type StationSourceInput = z.input<typeof stationSourceInput>;
export type StationSourceValues = z.output<typeof stationSourceInput>;

/** Шаблоны маппинга для типичных форматов экспорта (подставляются в форму). */
export const MAPPING_TEMPLATES: Record<"wide" | "long" | "split", string> = {
  wide: JSON.stringify(
    {
      delimiter: ";",
      encoding: "utf-8",
      headerRow: 1,
      layout: "wide",
      time: { column: "Date/Time", format: "DD.MM.YYYY HH:mm", timezone: "Asia/Dushanbe" },
      pollutants: {
        "PM2.5": { column: "PM2.5" },
        PM10: { column: "PM10" },
        NO2: { column: "NO2", unit: "µg/m³" },
        SO2: { column: "SO2" },
        CO: { column: "CO", unit: "mg/m³" },
        O3: { column: "O3" },
      },
      statusColumn: "Status",
      invalidStatuses: ["CAL", "ERR", "MAINT"],
      missingValues: ["", "-", "-999", "NaN"],
    },
    null,
    2,
  ),
  long: JSON.stringify(
    {
      delimiter: ",",
      encoding: "utf-8",
      headerRow: 1,
      layout: "long",
      time: { column: "timestamp", timezone: "UTC" },
      pollutantColumn: "parameter",
      valueColumn: "value",
      unitColumn: "unit",
      flagColumn: "status",
      pollutantAliases: { "Ozone 1h": "O3", "Nitrogen dioxide": "NO2" },
    },
    null,
    2,
  ),
  split: JSON.stringify(
    {
      delimiter: "tab",
      encoding: "windows-1251",
      headerRow: 1,
      layout: "wide",
      time: {
        dateColumn: "Дата",
        timeColumn: "Время",
        format: "DD.MM.YYYY",
        timeFormat: "HH:mm",
        timezone: "Asia/Dushanbe",
      },
      pollutants: { PM25: { column: "PM2.5, мкг/м3" }, PM10: { column: "PM10, мкг/м3" } },
      averagingMin: 60,
    },
    null,
    2,
  ),
};
