"use server";

import { eq, subscriptionToken } from "@meteo/db";
import { emailOutbox, type SubscriberTopics, subscribers } from "@meteo/db/schema";
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

/** Письмо подтверждения — не чаще раза в час на адрес (повтор формы при потерянном письме). */
function confirmDedupKey(id: number, token: string, now: Date): string {
  return `confirm:${id}:${token}:${Math.floor(now.getTime() / 3_600_000)}`;
}

/**
 * Подписка с двойным подтверждением: запись pending + письмо с токеном через очередь worker'а.
 * Форма открыта без входа, поэтому ответ одинаков для нового и существующего адреса, а изменения
 * уже подтверждённой подписки (темы, язык) применяются только после перехода по ссылке из письма —
 * иначе любой, кто знает адрес, мог бы переписать чужие настройки.
 */
export async function subscribe(raw: unknown): Promise<SubscribeResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "validation" };
  const v = parsed.data;
  if (!v.all && v.stations.length === 0 && !v.newsletter) return { ok: false, message: "topics" };
  const locale: Locale = isLocale(v.locale) ? v.locale : "tg";
  const db = getDb();
  const now = new Date();
  const existing = await db.query.subscribers.findFirst({ where: eq(subscribers.email, v.email) });
  const topics: SubscriberTopics = {
    all: v.all,
    stations: v.all ? [] : v.stations,
    newsletter: v.newsletter,
  };
  let id: number;
  let confirmToken: string;
  if (existing?.status === "confirmed") {
    // Подтверждённая подписка не меняется без подтверждения: запрошенные темы ждут перехода по ссылке.
    confirmToken = subscriptionToken();
    const { pending: _previous, ...current } = existing.topics;
    await db
      .update(subscribers)
      .set({ topics: { ...current, pending: { ...topics, locale } }, confirmToken })
      .where(eq(subscribers.id, existing.id));
    id = existing.id;
  } else if (existing) {
    // pending — тот же токен (ранее отправленные письма остаются действительными); unsubscribed — новый.
    confirmToken = existing.status === "pending" ? existing.confirmToken : subscriptionToken();
    await db
      .update(subscribers)
      .set({ locale, topics, status: "pending", confirmToken, unsubscribedAt: null })
      .where(eq(subscribers.id, existing.id));
    id = existing.id;
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
      dedupKey: confirmDedupKey(id, confirmToken, now),
    })
    .onConflictDoNothing();
  return { ok: true };
}
