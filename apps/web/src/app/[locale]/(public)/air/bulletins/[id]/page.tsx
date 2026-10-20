import { type BulletinLang, type EcoDocKind, isEcoDocKind } from "@meteo/core";
import { getEcoBulletinSettings, getPublishedEcoBulletin } from "@meteo/db";
import { type Locale, locales, localeTags } from "@meteo/i18n";
import { buttonVariants } from "@meteo/ui/components/button";
import { ArrowLeftIcon, DownloadIcon } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ecoDateValue } from "@/components/eco-bulletins/date";
import { EcoDocPreview } from "@/components/eco-bulletins/eco-doc-preview";
import { EcoDocSwitcher } from "@/components/eco-bulletins/eco-doc-switcher";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { ecoBulletinTitle, ecoDocument } from "@/lib/eco-bulletin";
import { name } from "@/lib/format";

export const dynamic = "force-dynamic";

function docLang(locale: Locale, raw: string | undefined): BulletinLang {
  if (raw === "tg" || raw === "ru") return raw;
  return locale === "tg" ? "tg" : "ru";
}

function localizedHref(locale: string, path: string): string {
  return `${locale === "tg" ? "" : `/${locale}`}${path}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale: raw, id } = await params;
  const locale = raw as Locale;
  const row = await getPublishedEcoBulletin(getDb(), Number(id)).catch(() => null);
  if (!row) return {};
  const t = await getTranslations({ locale, namespace: "ecoBulletin" });
  const title = ecoBulletinTitle(row.data, docLang(locale, undefined));
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return {
    title,
    description: t("public.intro"),
    alternates: {
      canonical: `${base}${localizedHref(locale, `/air/bulletins/${row.id}`)}`,
      languages: Object.fromEntries(
        locales.map((l) => [
          localeTags[l],
          `${base}${localizedHref(l, `/air/bulletins/${row.id}`)}`,
        ]),
      ),
    },
  };
}

export default async function EcoBulletinPublicPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ doc?: string; lang?: string }>;
}) {
  const { locale, id: rawId } = (await params) as { locale: Locale; id: string };
  setRequestLocale(locale);
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();
  const row = await getPublishedEcoBulletin(db, id);
  if (!row) notFound();
  const sp = await searchParams;
  const kind: EcoDocKind = isEcoDocKind(sp.doc) ? sp.doc : "city";
  const lang = docLang(locale, sp.lang);
  const [t, format, settings] = await Promise.all([
    getTranslations("ecoBulletin"),
    getFormatter(),
    getEcoBulletinSettings(db),
  ]);
  const doc = ecoDocument(row, settings, kind, lang);
  const files = ["docx", "pdf"].filter((ext) =>
    row.files.some((f) => f.name === `${kind}-${lang}.${ext}`),
  );

  return (
    <div className="container-page flex flex-col gap-6 py-10">
      <div className="flex flex-col gap-3">
        <Link
          href="/air/bulletins"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon className="size-4" aria-hidden="true" />
          {t("public.back")}
        </Link>
        <h1 className="text-3xl font-semibold tracking-tight">
          {t("public.forDate", {
            date: format.dateTime(ecoDateValue(row.date), { dateStyle: "long" }),
          })}
          {" · "}
          {name(row.data.city.name, locale)}
        </h1>
        <p className="text-muted-foreground">
          {t("public.station")}:{" "}
          <Link href={`/air/stations/${row.stationSlug}`} className="hover:underline">
            {name(row.stationName, locale)}
          </Link>
          {row.publishedAt
            ? ` · ${t("fields.publishedAt")}: ${format.dateTime(row.publishedAt, { dateStyle: "medium" })}`
            : ""}
        </p>
      </div>
      <EcoDocSwitcher basePath={`/air/bulletins/${id}`} kind={kind} lang={lang} />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{t("public.documents")}:</span>
        {files.map((ext) => (
          <a
            key={ext}
            href={`/api/v1/eco-bulletins/${id}/${kind}-${lang}.${ext}`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <DownloadIcon aria-hidden="true" />
            {ext.toUpperCase()}
          </a>
        ))}
        <a
          href={`/api/v1/eco-bulletins/${id}/${kind}-${lang}.html`}
          target="_blank"
          rel="noopener"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          {t("download.html")}
        </a>
      </div>
      <EcoDocPreview doc={doc} />
      <p className="text-sm text-muted-foreground">{t("public.languageNote")}</p>
    </div>
  );
}
