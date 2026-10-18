import { can } from "@meteo/core";
import { eq } from "@meteo/db";
import { bulletins } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { Badge } from "@meteo/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@meteo/ui/components/card";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { BulletinActions } from "@/components/admin/bulletins/bulletin-actions";
import { BulletinForm } from "@/components/admin/bulletins/bulletin-form";
import { MarkdownContent } from "@/components/news/markdown-content";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { requireAdminSession } from "@/lib/session";
import type { BulletinInput } from "@/lib/validation/news";
import { loadBulletinFormData } from "../_data";
import { deleteBulletin, sendBulletin, updateBulletin } from "../actions";

export const dynamic = "force-dynamic";

const STATUS_VARIANT = { draft: "secondary", queued: "outline", sent: "default" } as const;

export default async function BulletinPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id: rawId } = (await params) as { locale: Locale; id: string };
  setRequestLocale(locale);
  const session = await requireAdminSession(locale, "content.read");
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();
  const bulletin = await getDb().query.bulletins.findFirst({ where: eq(bulletins.id, id) });
  if (!bulletin) notFound();
  const [t, format, data] = await Promise.all([
    getTranslations("bulletins"),
    getFormatter(),
    loadBulletinFormData(),
  ]);
  const canWrite = can(session.user.role, "content.write");
  const canSend = can(session.user.role, "content.publish");
  const editable = canWrite && bulletin.status === "draft";

  async function action(raw: BulletinInput) {
    "use server";
    return updateBulletin(locale, id, raw);
  }
  async function send() {
    "use server";
    return sendBulletin(locale, id);
  }
  async function remove() {
    "use server";
    return deleteBulletin(locale, id);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {name(bulletin.subject, locale) || t("edit")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("fields.createdAt")}: {format.dateTime(bulletin.createdAt, { dateStyle: "medium" })}
            {bulletin.sentAt
              ? ` · ${t("fields.sentAt")}: ${format.dateTime(bulletin.sentAt, { dateStyle: "medium", timeStyle: "short" })}`
              : ""}
            {bulletin.status !== "draft"
              ? ` · ${t("fields.recipients")}: ${bulletin.recipients}`
              : ""}
          </p>
        </div>
        <Badge variant={STATUS_VARIANT[bulletin.status]}>{t(`status.${bulletin.status}`)}</Badge>
        {editable ? (
          <div className="ml-auto">
            <BulletinActions
              recipients={data.subscribersCount}
              canSend={canSend}
              send={send}
              remove={remove}
            />
          </div>
        ) : null}
      </div>
      {editable ? (
        <BulletinForm
          posts={data.posts}
          initial={{
            id: bulletin.id,
            subject: {
              tg: bulletin.subject.tg ?? "",
              ru: bulletin.subject.ru ?? "",
              en: bulletin.subject.en ?? "",
            },
            body: {
              tg: bulletin.body.tg ?? "",
              ru: bulletin.body.ru ?? "",
              en: bulletin.body.en ?? "",
            },
            postId: (bulletin.postId ?? "") as unknown as number,
          }}
          action={action}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {(["tg", "ru", "en"] as const).map((l) => (
            <Card key={l}>
              <CardHeader>
                <CardTitle className="text-base">
                  {l.toUpperCase()} · {bulletin.subject[l] || "—"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {bulletin.body[l] ? (
                  <MarkdownContent markdown={bulletin.body[l] ?? ""} lang={l} className="text-sm" />
                ) : (
                  <p className="text-sm text-muted-foreground">—</p>
                )}
              </CardContent>
            </Card>
          ))}
          {bulletin.status !== "draft" ? (
            <p className="text-sm text-muted-foreground lg:col-span-3">{t("locked")}</p>
          ) : null}
        </div>
      )}
    </>
  );
}
