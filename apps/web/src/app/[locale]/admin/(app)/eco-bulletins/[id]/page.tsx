import {
  type BulletinLang,
  can,
  type EcoDocKind,
  formatRatio,
  isEcoDocKind,
  pollutantLabel,
} from "@meteo/core";
import { and, count, eq, getEcoBulletin, getEcoBulletinSettings, sql } from "@meteo/db";
import { newsPosts, subscribers } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { Alert, AlertTitle } from "@meteo/ui/components/alert";
import { Badge } from "@meteo/ui/components/badge";
import { buttonVariants } from "@meteo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { ArrowLeftIcon, DownloadIcon, ExternalLinkIcon, TriangleAlertIcon } from "lucide-react";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { EcoBulletinActions } from "@/components/admin/eco-bulletins/eco-bulletin-actions";
import { ecoDateValue } from "@/components/eco-bulletins/date";
import { EcoDocPreview } from "@/components/eco-bulletins/eco-doc-preview";
import { EcoDocSwitcher } from "@/components/eco-bulletins/eco-doc-switcher";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { ecoDocument } from "@/lib/eco-bulletin";
import { name } from "@/lib/format";
import { pdfAvailable } from "@/lib/pdf";
import { requireAdminSession } from "@/lib/session";
import {
  deleteEcoBulletin,
  publishEcoBulletin,
  recomputeEcoBulletin,
  saveEcoBulletinGamma,
} from "../actions";

export const dynamic = "force-dynamic";

const STATUS_VARIANT = { draft: "secondary", published: "default" } as const;

export default async function EcoBulletinPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ doc?: string; lang?: string }>;
}) {
  const { locale, id: rawId } = (await params) as { locale: Locale; id: string };
  setRequestLocale(locale);
  const session = await requireAdminSession(locale, "ecoBulletin.read");
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();
  const row = await getEcoBulletin(db, id);
  if (!row) notFound();
  const sp = await searchParams;
  const kind: EcoDocKind = isEcoDocKind(sp.doc) ? sp.doc : "city";
  const lang: BulletinLang =
    sp.lang === "tg" || sp.lang === "ru" ? sp.lang : locale === "tg" ? "tg" : "ru";
  const [t, format, settings, subs, post, pdfOk] = await Promise.all([
    getTranslations("ecoBulletin"),
    getFormatter(),
    getEcoBulletinSettings(db),
    db
      .select({ n: count() })
      .from(subscribers)
      .where(
        and(
          eq(subscribers.status, "confirmed"),
          sql`coalesce((${subscribers.topics}->>'newsletter')::boolean, false)`,
        ),
      )
      .then((r) => r[0]?.n ?? 0),
    row.postId
      ? db
          .select({ slug: newsPosts.slug })
          .from(newsPosts)
          .where(eq(newsPosts.id, row.postId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
    pdfAvailable(),
  ]);
  const doc = ecoDocument(row, settings, kind, lang);
  const data = row.data;
  const stats = data.cityStats;
  const canWrite = can(session.user.role, "ecoBulletin.write");
  const canPublish = can(session.user.role, "ecoBulletin.publish");
  const textLang: BulletinLang = locale === "tg" ? "tg" : "ru";
  const missing = stats.rows
    .filter((r) => r.today.samples === 0)
    .map((r) => pollutantLabel(r.pollutant, textLang, "nom"));
  const exceeded = [
    ...stats.exceedances.both,
    ...stats.exceedances.dailyOnly,
    ...stats.exceedances.singleOnly,
  ]
    .map((pid) => stats.rows.find((r) => r.pollutant.id === pid))
    .filter((r): r is NonNullable<typeof r> => Boolean(r));
  const basePath = `/admin/eco-bulletins/${id}`;
  const fileBase = `/api/admin/eco-bulletins/${id}/${kind}-${lang}`;

  async function saveGamma(raw: unknown) {
    "use server";
    return saveEcoBulletinGamma(locale, id, raw);
  }
  async function recompute() {
    "use server";
    return recomputeEcoBulletin(locale, id);
  }
  async function publish(raw: unknown) {
    "use server";
    return publishEcoBulletin(locale, id, raw);
  }
  async function remove() {
    "use server";
    return deleteEcoBulletin(locale, id);
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Link
          href="/admin/eco-bulletins"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          {t("title")}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("public.forDate", {
              date: format.dateTime(ecoDateValue(row.date), { dateStyle: "long" }),
            })}
            {" · "}
            {name(data.city.name, locale)}
          </h1>
          <Badge variant={STATUS_VARIANT[row.status]} data-testid="eco-status">
            {t(`status.${row.status}`)}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("fields.station")}: {row.stationCode} — {name(row.stationName, locale)} ·{" "}
          {row.generatedBy === "scheduler" ? t("generatedBy.scheduler") : t("generatedBy.manual")}
          {row.authorName ? ` (${row.authorName})` : ""} ·{" "}
          {t("summary.computedAt", {
            time: format.dateTime(new Date(data.computedAt), {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          })}
          {row.publishedAt
            ? ` · ${t("fields.publishedAt")}: ${format.dateTime(row.publishedAt, { dateStyle: "medium", timeStyle: "short" })}`
            : ""}
        </p>
      </div>

      {!stats.hasData ? (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{t("warnings.noData")}</AlertTitle>
        </Alert>
      ) : null}
      {stats.hasData && !stats.hasYesterday ? (
        <Alert>
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{t("warnings.noYesterday")}</AlertTitle>
        </Alert>
      ) : null}
      {stats.hasData && missing.length > 0 ? (
        <Alert>
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{t("warnings.missing", { list: missing.join(", ") })}</AlertTitle>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-4">
          <EcoDocSwitcher basePath={basePath} kind={kind} lang={lang} />
          <div className="flex flex-wrap items-center gap-2" data-testid="eco-downloads">
            <span className="text-sm text-muted-foreground">{t("downloadTitle")}:</span>
            <a
              href={`${fileBase}.docx`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
              data-testid="eco-download-docx"
            >
              <DownloadIcon aria-hidden="true" />
              {t("download.docx")}
            </a>
            <a
              href={`${fileBase}.pdf`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
              data-testid="eco-download-pdf"
            >
              <DownloadIcon aria-hidden="true" />
              {t("download.pdf")}
            </a>
            <a
              href={`${fileBase}.html`}
              target="_blank"
              rel="noopener"
              className={buttonVariants({ variant: "outline", size: "sm" })}
              data-testid="eco-download-html"
            >
              <ExternalLinkIcon aria-hidden="true" />
              {t("download.html")}
            </a>
            {!pdfOk ? <span className="text-xs text-muted-foreground">{t("pdfHint")}</span> : null}
          </div>
          <EcoDocPreview doc={doc} />
        </div>
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("summary.title")}</CardTitle>
              <CardDescription>
                {t("summary.cities", { count: data.cities.length })}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p>
                <span className="text-muted-foreground">{t("summary.exceedances")}: </span>
                {exceeded.length === 0
                  ? t("summary.none")
                  : exceeded
                      .map(
                        (r) =>
                          `${pollutantLabel(r.pollutant, textLang, "nom")} — ${formatRatio(r.today.ratioDaily)} / ${formatRatio(r.today.ratioSingle)}`,
                      )
                      .join("; ")}
              </p>
              <p>
                <span className="text-muted-foreground">{t("summary.summation")}: </span>
                {formatRatio(stats.summation.today)}
                {stats.summation.change
                  ? ` (${formatRatio(stats.summation.change.from)} → ${formatRatio(stats.summation.change.to)})`
                  : ""}
              </p>
              {stats.highPollution.length > 0 || stats.extremePollution.length > 0 ? (
                <p className="text-destructive">
                  {stats.extremePollution.length > 0 ? t("summary.extreme") : t("summary.high")}
                </p>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("fields.status")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {row.status === "draft" ? (
                <EcoBulletinActions
                  id={id}
                  date={row.date}
                  status={row.status}
                  gamma={row.gamma}
                  subscribers={subs}
                  canWrite={canWrite}
                  canPublish={canPublish}
                  saveGamma={saveGamma}
                  recompute={recompute}
                  publish={publish}
                  remove={remove}
                />
              ) : (
                <div className="flex flex-col gap-2 text-sm">
                  <p className="text-muted-foreground">{t("errors.locked")}</p>
                  <Link
                    href={`/air/bulletins/${id}`}
                    className="underline-offset-4 hover:underline"
                  >
                    {t("openPublic")}
                  </Link>
                  {post ? (
                    <Link
                      href={`/news/${post.slug}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {t("openPost")}
                    </Link>
                  ) : null}
                  {row.gamma ? (
                    <p>
                      {t("fields.gamma")}: {row.gamma}
                    </p>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
