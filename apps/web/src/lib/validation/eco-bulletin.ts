import { z } from "zod";
import { isoDate } from "./common";

export const ecoBulletinGenerateInput = z.object({
  date: isoDate,
  stationId: z.coerce.number().int().positive({ message: "station" }),
});
export type EcoBulletinGenerateInput = z.input<typeof ecoBulletinGenerateInput>;

export const ecoBulletinGammaInput = z.object({
  gamma: z.string().trim().max(32, "max"),
});

export const ecoBulletinPublishInput = z.object({
  mail: z.boolean().default(false),
});

const text2 = (max: number) =>
  z.object({
    tg: z.string().trim().max(max, "max").default(""),
    ru: z.string().trim().max(max, "max").default(""),
  });

export const ecoBulletinSettingsInput = z.object({
  scheduleEnabled: z.boolean().default(true),
  notifyOperators: z.boolean().default(true),
  stationIds: z.array(z.coerce.number().int().positive()).max(100).default([]),
  department: text2(120),
  causes: text2(1000),
  summation: z.enum(["max_single", "daily"]).default("max_single"),
});
export type EcoBulletinSettingsInput = z.input<typeof ecoBulletinSettingsInput>;
