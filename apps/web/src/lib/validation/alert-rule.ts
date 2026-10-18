import { z } from "zod";
import { emptyToNull } from "./common";

export const ruleInput = z
  .object({
    name: z.string().trim().min(2, "min").max(120, "max"),
    scope: z.enum(["all", "station", "region"]),
    stationId: z
      .preprocess(emptyToNull, z.coerce.number().int().positive().nullable())
      .default(null),
    regionId: z
      .preprocess(emptyToNull, z.coerce.number().int().positive().nullable())
      .default(null),
    kind: z.enum(["pollutant", "index"]),
    pollutantId: z
      .preprocess(emptyToNull, z.coerce.number().int().positive().nullable())
      .default(null),
    scaleId: z.preprocess(emptyToNull, z.coerce.number().int().positive().nullable()).default(null),
    threshold: z.coerce.number().positive("positive"),
    averagingMin: z.coerce
      .number()
      .int()
      .refine((v) => [60, 480, 1440].includes(v), "averaging"),
    cooldownMin: z.coerce.number().int().min(0).max(10080),
    channels: z.array(z.enum(["portal", "email"])).min(1, "channels"),
    enabled: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.scope === "station" && !v.stationId)
      ctx.addIssue({ code: "custom", path: ["stationId"], message: "required" });
    if (v.scope === "region" && !v.regionId)
      ctx.addIssue({ code: "custom", path: ["regionId"], message: "required" });
    if (v.kind === "pollutant" && !v.pollutantId)
      ctx.addIssue({ code: "custom", path: ["pollutantId"], message: "required" });
    if (v.kind === "index" && !v.scaleId)
      ctx.addIssue({ code: "custom", path: ["scaleId"], message: "required" });
    if (v.kind === "index" && (v.threshold < 1 || v.threshold > 5))
      ctx.addIssue({ code: "custom", path: ["threshold"], message: "level" });
  });
export type RuleInput = z.input<typeof ruleInput>;
export type RuleValues = z.output<typeof ruleInput>;
