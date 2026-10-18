"use server";

import { eq } from "@meteo/db";
import { capEventTranslations } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { z } from "zod";
import { recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session";
import { localizedText } from "@/lib/validation/common";

export type CapEventResult = { ok: true; id: number } | { ok: false; message: string };

const eventInput = z.object({
  id: z.coerce.number().int().positive().optional(),
  event: z.string().trim().min(1, "required").max(255, "max"),
  name: localizedText,
});

/** Создаёт или обновляет перевод типа события CAP (словарь tg/ru/en). */
export async function saveCapEvent(locale: Locale, raw: unknown): Promise<CapEventResult> {
  const session = await requireAdminSession(locale, "alerts.manage");
  const parsed = eventInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "validation" };
  const { id, event, name } = parsed.data;
  const db = getDb();
  if (id) {
    const before = await db.query.capEventTranslations.findFirst({
      where: eq(capEventTranslations.id, id),
    });
    if (!before) return { ok: false, message: "notFound" };
    await db.update(capEventTranslations).set({ name }).where(eq(capEventTranslations.id, id));
    await recordAudit(session, {
      action: "capEvent.update",
      entity: "cap_event_translations",
      entityId: id,
      before: { event: before.event, name: before.name },
      after: { event: before.event, name },
    });
    return { ok: true, id };
  }
  const [row] = await db
    .insert(capEventTranslations)
    .values({ event, name })
    .onConflictDoUpdate({ target: capEventTranslations.event, set: { name } })
    .returning({ id: capEventTranslations.id });
  if (!row) return { ok: false, message: "insert" };
  await recordAudit(session, {
    action: "capEvent.create",
    entity: "cap_event_translations",
    entityId: row.id,
    after: { event, name },
  });
  return { ok: true, id: row.id };
}

export async function deleteCapEvent(locale: Locale, id: number): Promise<CapEventResult> {
  const session = await requireAdminSession(locale, "alerts.manage");
  const db = getDb();
  const before = await db.query.capEventTranslations.findFirst({
    where: eq(capEventTranslations.id, id),
  });
  if (!before) return { ok: false, message: "notFound" };
  await db.delete(capEventTranslations).where(eq(capEventTranslations.id, id));
  await recordAudit(session, {
    action: "capEvent.delete",
    entity: "cap_event_translations",
    entityId: id,
    before: { event: before.event, name: before.name },
  });
  return { ok: true, id };
}
