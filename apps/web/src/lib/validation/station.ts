import { CONCENTRATION_UNITS } from "@meteo/core";
import { z } from "zod";
import { emptyToNull, isoDate, localizedText } from "./common";

export const stationKinds = ["air", "meteo", "combined"] as const;
export const stationStatuses = ["active", "suspended", "decommissioned"] as const;
export const stationDataSources = ["manual", "import", "api", "sensor"] as const;
export const stationSamplings = ["continuous", "discrete"] as const;

export const stationPollutantInput = z.object({
  pollutantId: z.coerce.number().int().positive(),
  inputUnit: z.enum(CONCENTRATION_UNITS).default("µg/m³"),
  active: z.boolean().default(true),
});

export const stationInput = z.object({
  code: z
    .string()
    .trim()
    .min(2, "min")
    .max(32, "max")
    .regex(/^[A-Za-z0-9_-]+$/, "format"),
  slug: z
    .string()
    .trim()
    .max(64, "max")
    .regex(/^[a-z0-9-]*$/, "format")
    .optional()
    .default(""),
  name: localizedText.refine((t) => Boolean(t.tg?.trim() || t.ru?.trim() || t.en?.trim()), {
    message: "required",
    path: ["tg"],
  }),
  kind: z.enum(stationKinds).default("air"),
  status: z.enum(stationStatuses).default("active"),
  lat: z.coerce.number().min(35, "range").max(42, "range"),
  lon: z.coerce.number().min(66, "range").max(76, "range"),
  elevationM: z
    .preprocess(emptyToNull, z.coerce.number().min(-100).max(8000).nullable())
    .default(null),
  regionId: z.preprocess(emptyToNull, z.coerce.number().int().positive().nullable()).default(null),
  districtId: z
    .preprocess(emptyToNull, z.coerce.number().int().positive().nullable())
    .default(null),
  commissionedAt: z.preprocess(emptyToNull, isoDate.nullable()).default(null),
  decommissionedAt: z.preprocess(emptyToNull, isoDate.nullable()).default(null),
  dataSource: z.enum(stationDataSources).default("manual"),
  sampling: z.enum(stationSamplings).default("discrete"),
  isPublic: z.boolean().default(true),
  description: localizedText.optional(),
  address: localizedText.optional(),
  pollutants: z.array(stationPollutantInput).default([]),
});

export type StationInput = z.input<typeof stationInput>;
export type StationValues = z.output<typeof stationInput>;
