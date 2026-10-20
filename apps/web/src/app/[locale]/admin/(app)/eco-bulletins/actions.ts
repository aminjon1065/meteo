"use server";

import { type BulletinLang, type EcoDocKind, localDateOf } from "@meteo/core";
import {
  computeEcoBulletin,
  EcoBulletinError,
  type EcoBulletinFile,
  eq,
  getEcoBulletin,
  getEcoBulletinSettings,
  saveEcoBulletinSettings as persistEcoBulletinSettings,
  queueBulletin,
  upsertEcoBulletinDraft,
} from "@meteo/db";
import { bulletins, ecoBulletins, newsCategories, newsPosts } from "@meteo/db/schema";
import type { I18nText, Locale } from "@meteo/i18n";
import { getTranslations } from "next-intl/server";
import { recordAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db-errors";
import {
  type EcoMarkdownLabels,
  ecoBulletinMarkdown,
  ecoBulletinTitle,
  ecoDocument,
  ecoFileName,
  renderEcoFile,
  storeEcoFile,
} from "@/lib/eco-bulletin";
import { env } from "@/lib/env";
import { requireAdminSession } from "@/lib/session";
import { fieldErrorsOf } from "@/lib/validation/common";
import {
  ecoBulletinGammaInput,
  ecoBulletinGenerateInput,
  ecoBulletinPublishInput,
  ecoBulletinSettingsInput,
} from "@/lib/validation/eco-bulletin";

export type EcoBulletinResult =
  | { ok: true; id: number; recipients?: number; postId?: number | null }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

function failure(error: unknown): EcoBulletinResult {
  if (error instanceof EcoBulletinError) return { ok: false, message: error.code };
  throw error;
}

/** Расчёт и сохранение черновика за дату по станции (повторный вызов пересчитывает черновик). */
export async function generateEcoBulletin(
  locale: Locale,
  raw: unknown,
): Promise<EcoBulletinResult> {
  const session = await requireAdminSession(locale, "ecoBulletin.write");
  const parsed = ecoBulletinGenerateInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, message: "validation", fieldErrors: fieldErrorsOf(parsed.error) };
  const { date, stationId } = parsed.data;
  if (date > localDateOf(new Date()))
    return { ok: false, message: "future", fieldErrors: { date: ["future"] } };
  const db = getDb();
  try {
    const data = await computeEcoBulletin(db, { date, stationId });
    const result = await upsertEcoBulletinDraft(db, {
      date,
      stationId,
      data,
      userId: session.user.id,
      generatedBy: "manual",
    });
    if (result.status === "draft") {
      await recordAudit(session, {
        action: result.created ? "ecoBulletin.generate" : "ecoBulletin.recompute",
        entity: "eco_bulletins",
        entityId: result.id,
        after: { date, stationId, hasData: data.cityStats.hasData },
      });
    }
    return { ok: true, id: result.id };
  } catch (error) {
    return failure(error);
  }
}

/** Пересчёт черновика по текущим измерениям (гамма‑фон сохраняется). */
export async function recomputeEcoBulletin(locale: Locale, id: number): Promise<EcoBulletinResult> {
  const session = await requireAdminSession(locale, "ecoBulletin.write");
  const db = getDb();
  const row = await getEcoBulletin(db, id);
  if (!row) return { ok: false, message: "notFound" };
  if (row.status !== "draft") return { ok: false, message: "locked" };
  try {
    const data = await computeEcoBulletin(db, { date: row.date, stationId: row.stationId });
    await db
      .update(ecoBulletins)
      .set({ data, updatedBy: session.user.id })
      .where(eq(ecoBulletins.id, id));
    await recordAudit(session, {
      action: "ecoBulletin.recompute",
      entity: "eco_bulletins",
      entityId: id,
      after: { date: row.date, stationId: row.stationId, hasData: data.cityStats.hasData },
    });
    return { ok: true, id };
  } catch (error) {
    return failure(error);
  }
}

export async function saveEcoBulletinGamma(
  locale: Locale,
  id: number,
  raw: unknown,
): Promise<EcoBulletinResult> {
  const session = await requireAdminSession(locale, "ecoBulletin.write");
  const parsed = ecoBulletinGammaInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, message: "validation", fieldErrors: fieldErrorsOf(parsed.error) };
  const db = getDb();
  const row = await getEcoBulletin(db, id);
  if (!row) return { ok: false, message: "notFound" };
  if (row.status !== "draft") return { ok: false, message: "locked" };
  const gamma = parsed.data.gamma || null;
  await db
    .update(ecoBulletins)
    .set({ gamma, updatedBy: session.user.id })
    .where(eq(ecoBulletins.id, id));
  await recordAudit(session, {
    action: "ecoBulletin.gamma",
    entity: "eco_bulletins",
    entityId: id,
    before: { gamma: row.gamma },
    after: { gamma },
  });
  return { ok: true, id };
}

export async function deleteEcoBulletin(locale: Locale, id: number): Promise<EcoBulletinResult> {
  const session = await requireAdminSession(locale, "ecoBulletin.write");
  const db = getDb();
  const row = await getEcoBulletin(db, id);
  if (!row) return { ok: false, message: "notFound" };
  if (row.status !== "draft") return { ok: false, message: "locked" };
  await db.delete(ecoBulletins).where(eq(ecoBulletins.id, id));
  await recordAudit(session, {
    action: "ecoBulletin.delete",
    entity: "eco_bulletins",
    entityId: id,
    before: { date: row.date, stationId: row.stationId },
  });
  return { ok: true, id };
}

const LANGS: readonly BulletinLang[] = ["tg", "ru"];
const KINDS: readonly EcoDocKind[] = ["city", "summary", "form4a"];

async function markdownLabels(locale: Locale): Promise<EcoMarkdownLabels> {
  const t = await getTranslations({ locale, namespace: "ecoBulletin" });
  return {
    files: t("news.files"),
    docs: { city: t("news.cityDoc"), summary: t("news.summaryDoc"), form4a: t("news.form4aDoc") },
    langs: { tg: t("lang.tg"), ru: t("lang.ru") },
    readMore: t("news.readMore"),
  };
}

/**
 * Публикация: файлы DOCX (и PDF, если есть Chromium) сохраняются в UPLOADS_DIR/eco-bulletins/{id},
 * создаётся опубликованная новость рубрики «Бюллетени» с текстом и ссылками, при желании —
 * рассылка подписчикам через существующие бюллетени (email_outbox). Опубликованное не меняется.
 */
export async function publishEcoBulletin(
  locale: Locale,
  id: number,
  raw: unknown,
): Promise<EcoBulletinResult> {
  const session = await requireAdminSession(locale, "ecoBulletin.publish");
  const parsed = ecoBulletinPublishInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: "validation" };
  const db = getDb();
  const row = await getEcoBulletin(db, id);
  if (!row) return { ok: false, message: "notFound" };
  if (row.status !== "draft") return { ok: false, message: "locked" };
  const settings = await getEcoBulletinSettings(db);
  const created = new Date();

  // 1. Файлы: все документы на двух языках; PDF — только когда Chromium доступен.
  const files: EcoBulletinFile[] = [];
  for (const kind of KINDS) {
    for (const lang of LANGS) {
      const doc = ecoDocument(row, settings, kind, lang);
      const docx = await renderEcoFile(doc, "docx", { created });
      if (docx) files.push(storeEcoFile(id, ecoFileName({ kind, lang, ext: "docx" }), docx));
      const pdf = await renderEcoFile(doc, "pdf");
      if (pdf) files.push(storeEcoFile(id, ecoFileName({ kind, lang, ext: "pdf" }), pdf));
    }
  }

  // 2. Новость с текстом сравнения и ссылками на файлы.
  const labels = {
    tg: await markdownLabels("tg"),
    ru: await markdownLabels("ru"),
    en: await markdownLabels("en"),
  };
  const links = (lang: BulletinLang) => ({
    pageUrl: `${lang === "tg" ? "" : "/ru"}/air/bulletins/${id}`,
    fileUrl: (name: string) => `/api/v1/eco-bulletins/${id}/${name}`,
    files,
  });
  const body: I18nText = {
    tg: ecoBulletinMarkdown(row.data, "tg", settings, links("tg"), labels.tg),
    ru: ecoBulletinMarkdown(row.data, "ru", settings, links("ru"), labels.ru),
    en: ecoBulletinMarkdown(row.data, "ru", settings, links("ru"), labels.en),
  };
  const title: I18nText = {
    tg: ecoBulletinTitle(row.data, "tg"),
    ru: ecoBulletinTitle(row.data, "ru"),
    en: (await getTranslations({ locale: "en", namespace: "ecoBulletin" }))("news.title", {
      city: row.data.city.name.en ?? row.data.city.name.ru ?? row.stationCode,
      date: row.date,
    }),
  };
  const excerpt: I18nText = {};
  for (const l of ["tg", "ru", "en"] as const) {
    const t = await getTranslations({ locale: l, namespace: "ecoBulletin" });
    excerpt[l] = t("news.excerpt", {
      city: row.data.city.name[l] ?? row.data.city.name.ru ?? row.stationCode,
      date: row.date,
    });
  }
  const category = await db
    .select({ id: newsCategories.id })
    .from(newsCategories)
    .where(eq(newsCategories.slug, "bulletins"))
    .then((r) => r[0] ?? null);
  const baseSlug = `eco-bulletin-${row.date}-${row.stationSlug}`.slice(0, 110);
  let postId: number | null = null;
  for (const slug of [baseSlug, `${baseSlug}-${id}`]) {
    try {
      const [post] = await db
        .insert(newsPosts)
        .values({
          slug,
          categoryId: category?.id ?? null,
          title,
          excerpt,
          body,
          status: "published",
          publishedAt: created,
          authorId: session.user.id,
          updatedBy: session.user.id,
        })
        .returning({ id: newsPosts.id });
      postId = post?.id ?? null;
      break;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
  }

  // 3. Рассылка подписчикам бюллетеня (по желанию) — через существующий механизм bulletins.
  let mailBulletinId: number | null = null;
  let recipients = 0;
  if (parsed.data.mail) {
    const [mail] = await db
      .insert(bulletins)
      .values({ subject: title, body, postId, createdBy: session.user.id })
      .returning({ id: bulletins.id });
    if (mail) {
      mailBulletinId = mail.id;
      recipients = (await queueBulletin(db, mail.id, { publicUrl: env().NEXT_PUBLIC_APP_URL }))
        .recipients;
    }
  }

  await db
    .update(ecoBulletins)
    .set({
      status: "published",
      publishedAt: created,
      publishedBy: session.user.id,
      updatedBy: session.user.id,
      postId,
      mailBulletinId,
      files,
    })
    .where(eq(ecoBulletins.id, id));
  await recordAudit(session, {
    action: "ecoBulletin.publish",
    entity: "eco_bulletins",
    entityId: id,
    after: {
      date: row.date,
      stationId: row.stationId,
      postId,
      mailBulletinId,
      recipients,
      files: files.map((f) => f.name),
    },
  });
  return { ok: true, id, postId, recipients };
}

export type EcoBulletinSettingsResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

export async function saveEcoBulletinSettings(
  locale: Locale,
  raw: unknown,
): Promise<EcoBulletinSettingsResult> {
  const session = await requireAdminSession(locale, "ecoBulletin.write");
  const parsed = ecoBulletinSettingsInput.safeParse(raw);
  if (!parsed.success)
    return { ok: false, message: "validation", fieldErrors: fieldErrorsOf(parsed.error) };
  const db = getDb();
  const before = await getEcoBulletinSettings(db);
  await persistEcoBulletinSettings(db, parsed.data, session.user.id);
  await recordAudit(session, {
    action: "settings.ecoBulletin.update",
    entity: "settings",
    entityId: "ecoBulletin",
    before,
    after: parsed.data,
  });
  return { ok: true };
}
