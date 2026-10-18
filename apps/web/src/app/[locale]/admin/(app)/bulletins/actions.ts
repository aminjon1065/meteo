"use server";

import { eq, queueBulletin } from "@meteo/db";
import { bulletins } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { requireAdminSession } from "@/lib/session";
import { fieldErrorsOf } from "@/lib/validation/common";
import { bulletinInput } from "@/lib/validation/news";

export type BulletinResult =
  | { ok: true; id: number; recipients?: number }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

export async function createBulletin(locale: Locale, raw: unknown): Promise<BulletinResult> {
  const session = await requireAdminSession(locale, "content.write");
  const parsed = bulletinInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, message: "validation", fieldErrors: fieldErrorsOf(parsed.error) };
  const v = parsed.data;
  const [row] = await getDb()
    .insert(bulletins)
    .values({ subject: v.subject, body: v.body, postId: v.postId, createdBy: session.user.id })
    .returning({ id: bulletins.id });
  if (!row) return { ok: false, message: "insert" };
  await recordAudit(session, {
    action: "bulletin.create",
    entity: "bulletins",
    entityId: row.id,
    after: { subject: v.subject, postId: v.postId },
  });
  return { ok: true, id: row.id };
}

export async function updateBulletin(
  locale: Locale,
  id: number,
  raw: unknown,
): Promise<BulletinResult> {
  const session = await requireAdminSession(locale, "content.write");
  const parsed = bulletinInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, message: "validation", fieldErrors: fieldErrorsOf(parsed.error) };
  const v = parsed.data;
  const db = getDb();
  const before = await db.query.bulletins.findFirst({ where: eq(bulletins.id, id) });
  if (!before) return { ok: false, message: "notFound" };
  if (before.status !== "draft") return { ok: false, message: "locked" };
  await db
    .update(bulletins)
    .set({ subject: v.subject, body: v.body, postId: v.postId })
    .where(eq(bulletins.id, id));
  await recordAudit(session, {
    action: "bulletin.update",
    entity: "bulletins",
    entityId: id,
    before: { subject: before.subject, postId: before.postId },
    after: { subject: v.subject, postId: v.postId },
  });
  return { ok: true, id };
}

/** Ставит письма в email_outbox для всех подписчиков бюллетеня (отправляет worker/mailer). */
export async function sendBulletin(locale: Locale, id: number): Promise<BulletinResult> {
  const session = await requireAdminSession(locale, "content.publish");
  const db = getDb();
  const before = await db.query.bulletins.findFirst({ where: eq(bulletins.id, id) });
  if (!before) return { ok: false, message: "notFound" };
  if (before.status !== "draft") return { ok: false, message: "locked" };
  const { recipients } = await queueBulletin(db, id, { publicUrl: env().NEXT_PUBLIC_APP_URL });
  await recordAudit(session, {
    action: "bulletin.send",
    entity: "bulletins",
    entityId: id,
    after: { recipients, subject: before.subject },
  });
  return { ok: true, id, recipients };
}

export async function deleteBulletin(locale: Locale, id: number): Promise<BulletinResult> {
  const session = await requireAdminSession(locale, "content.write");
  const db = getDb();
  const before = await db.query.bulletins.findFirst({ where: eq(bulletins.id, id) });
  if (!before) return { ok: false, message: "notFound" };
  if (before.status !== "draft") return { ok: false, message: "locked" };
  await db.delete(bulletins).where(eq(bulletins.id, id));
  await recordAudit(session, {
    action: "bulletin.delete",
    entity: "bulletins",
    entityId: id,
    before: { subject: before.subject },
  });
  return { ok: true, id };
}
