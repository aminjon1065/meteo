"use server";

import { eq, subscriptionToken } from "@meteo/db";
import { emailOutbox, subscribers } from "@meteo/db/schema";
import { isLocale, type Locale } from "@meteo/i18n";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";

const input = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  locale: z.string(),
  all: z.boolean(),
  stations: z.array(z.coerce.number().int().positive()).max(100).default([]),
  newsletter: z.boolean().default(false),
  consent: z.literal(true),
  /** honeypot */
  website: z.string().max(0).optional(),
});

export type SubscribeResult = { ok: true } | { ok: false; message: string };

/** Подписка с двойным подтверждением: запись pending + письмо с токеном через очередь worker'а. */
export async function subscribe(raw: unknown): Promise<SubscribeResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "validation" };
  const v = parsed.data;
  if (!v.all && v.stations.length === 0 && !v.newsletter) return { ok: false, message: "topics" };
  const locale: Locale = isLocale(v.locale) ? v.locale : "tg";
  const db = getDb();
  const existing = await db.query.subscribers.findFirst({ where: eq(subscribers.email, v.email) });
  const topics = { all: v.all, stations: v.all ? [] : v.stations, newsletter: v.newsletter };
  let id: number;
  let confirmToken: string;
  if (existing) {
    confirmToken = existing.status === "pending" ? existing.confirmToken : subscriptionToken();
    await db
      .update(subscribers)
      .set({
        locale,
        topics,
        status: existing.status === "confirmed" ? "confirmed" : "pending",
        confirmToken,
        unsubscribedAt: null,
      })
      .where(eq(subscribers.id, existing.id));
    id = existing.id;
    if (existing.status === "confirmed") return { ok: true };
  } else {
    confirmToken = subscriptionToken();
    const [row] = await db
      .insert(subscribers)
      .values({
        email: v.email,
        locale,
        topics,
        confirmToken,
        unsubscribeToken: subscriptionToken(),
      })
      .returning({ id: subscribers.id });
    if (!row) return { ok: false, message: "insert" };
    id = row.id;
  }
  const base = env().NEXT_PUBLIC_APP_URL;
  const prefix = locale === "tg" ? "" : `/${locale}`;
  await db
    .insert(emailOutbox)
    .values({
      to: v.email,
      locale,
      template: "confirm",
      payload: { confirmUrl: `${base}${prefix}/subscribe/confirm?token=${confirmToken}` },
      dedupKey: `confirm:${id}:${confirmToken}`,
    })
    .onConflictDoNothing();
  return { ok: true };
}
