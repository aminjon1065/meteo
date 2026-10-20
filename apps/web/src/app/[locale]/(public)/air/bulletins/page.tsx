import { type EcoBulletinRow, listPublishedEcoBulletins } from "@meteo/db";
import type { Locale } from "@meteo/i18n";
import { Button, buttonVariants } from "@meteo/ui/components/button";
import { Card, CardContent } from "@meteo/ui/components/card";
import { ClipboardListIcon } from "lucide-react";
import type { Metadata } from "next";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { ecoDateValue } from "@/components/eco-bulletins/date";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 30;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "ecoBulletin" });
  return { title: t("public.title"), description: t("public.intro") };
}

function fileLinks(row: EcoBulletinRow, lang: "tg" | "ru"): Array<{ ext: string; href: string }> {
  return ["docx", "pdf"]
    .filter((ext) => row.files.some((f) => f.name === `city-${lang}.${ext}`))
    .map((ext) => ({ ext, href: `/api/v1/eco-bulletins/${row.id}/city-${lang}.${ext}` }));
}

export default async function EcoBulletinsArchivePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const [t, tc, format, list] = await Promise.all([
    getTranslations("ecoBulletin"),
    getTranslations("common"),
    getFormatter(),
    listPublishedEcoBulletins(getDb(), { page, pageSize: PAGE_SIZE }).catch(() => ({
      rows: [] as EcoBulletinRow[],
      total: 0,
    })),
  ]);
  const pages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));

  return (
    <div className="container-page flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-3">
        <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
          <ClipboardListIcon className="size-8 text-brand" aria-hidden="true" />
          {t("public.title")}
        </h1>
        <p className="max-w-3xl text-muted-foreground">{t("public.intro")}</p>
        <p className="text-sm text-muted-foreground">{t("public.languageNote")}</p>
      </div>
      {list.rows.length === 0 ? (
        <p className="rounded-lg border bg-card p-6 text-center text-muted-foreground">
          {t("public.empty")}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.rows.map((row) => (
            <li key={row.id}>
              <Card>
                <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <div className="min-w-56 flex-1">
                    <Link
                      href={`/air/bulletins/${row.id}`}
                      className="text-lg font-semibold hover:underline"
                    >
                      {t("public.forDate", {
                        date: format.dateTime(ecoDateValue(row.date), { dateStyle: "long" }),
                      })}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {name(row.data.city.name, locale)} · {t("public.station")}:{" "}
                      <Link href={`/air/stations/${row.stationSlug}`} className="hover:underline">
                        {name(row.stationName, locale)}
                      </Link>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      render={<Link href={`/air/bulletins/${row.id}`} />}
                      nativeButton={false}
                    >
                      {t("public.view")}
                    </Button>
                    {(["tg", "ru"] as const).flatMap((lang) =>
                      fileLinks(row, lang).map((f) => (
                        <a
                          key={`${lang}-${f.ext}`}
                          href={f.href}
                          className={buttonVariants({ variant: "outline", size: "sm" })}
                        >
                          {t(`lang.${lang}`)} {f.ext.toUpperCase()}
                        </a>
                      )),
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {pages > 1 ? (
        <nav
          className="flex items-center justify-between text-sm text-muted-foreground"
          aria-label={tc("pagination")}
        >
          <span>
            {page} / {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Button
                variant="outline"
                size="sm"
                render={<Link href={{ pathname: "/air/bulletins", query: { page: page - 1 } }} />}
                nativeButton={false}
              >
                ← {tc("actions.back")}
              </Button>
            ) : null}
            {page < pages ? (
              <Button
                variant="outline"
                size="sm"
                render={<Link href={{ pathname: "/air/bulletins", query: { page: page + 1 } }} />}
                nativeButton={false}
              >
                {tc("actions.more")} →
              </Button>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
