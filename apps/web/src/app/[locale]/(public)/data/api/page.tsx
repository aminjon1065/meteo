import type { Locale } from "@meteo/i18n";
import { buttonVariants } from "@meteo/ui/components/button";
import { DownloadIcon } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SchemaTree } from "@/components/data/schema-tree";
import { PageHeader } from "@/components/site/page-header";
import { Link } from "@/i18n/navigation";
import { listEndpoints } from "@/lib/api/openapi";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: locale as Locale, namespace: "apiDocs" });
  return { title: t("title"), description: t("intro") };
}

const method =
  "inline-flex h-5 items-center rounded-md bg-primary px-1.5 font-mono text-xs font-semibold text-primary-foreground";
const label = "eyebrow";

/** Документация публичного API, собранная из OpenAPI‑документа (Zod‑схемы). */
export default async function ApiDocsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("apiDocs");
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const endpoints = listEndpoints((key, values) => t(key as "title", values));
  const tags = [...new Set(endpoints.map((e) => e.tag))];

  return (
    <div className="container-page flex flex-col gap-8 py-8">
      <PageHeader
        title={t("title")}
        intro={t("intro")}
        actions={
          <>
            <a
              href={`/api/v1/openapi.json?lang=${locale}`}
              className={buttonVariants({ variant: "outline", size: "lg" })}
            >
              <DownloadIcon aria-hidden="true" />
              {t("download")}
            </a>
            <Link
              href="/data"
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              {t("backToData")}
            </Link>
          </>
        }
      >
        <dl className="grid gap-4 rounded-xl border bg-card px-4 py-3.5 text-sm sm:px-5 md:grid-cols-3">
          <div>
            <dt className={label}>{t("baseUrl")}</dt>
            <dd>
              <code className="font-mono text-xs break-all">{base}</code>
            </dd>
          </div>
          <div>
            <dt className={label}>{t("auth")}</dt>
            <dd>{t("authHint")}</dd>
          </div>
          <div>
            <dt className={label}>{t("cors")}</dt>
            <dd>{t("corsHint")}</dd>
          </div>
        </dl>
      </PageHeader>

      <nav aria-label={t("contents")} className="flex flex-wrap gap-1.5 text-sm">
        {endpoints.map((e) => (
          <a
            key={e.id}
            href={`#${e.id}`}
            className="rounded-full border bg-card px-3 py-1 font-mono text-xs hover:bg-muted"
          >
            {e.path}
          </a>
        ))}
      </nav>

      {tags.map((tag) => (
        <section key={tag} className="flex flex-col gap-4">
          <h2 className="text-h2">{t(`tags.${tag}` as "tags.air")}</h2>
          {endpoints
            .filter((e) => e.tag === tag)
            .map((e) => (
              <article
                key={e.id}
                id={e.id}
                className="flex scroll-mt-20 flex-col gap-4 rounded-xl border bg-card px-4 py-4 sm:px-5"
              >
                <header className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={method}>{e.method}</span>
                    <code className="font-mono text-sm break-all">{e.path}</code>
                    {e.cache ? (
                      <span className="text-caption text-muted-foreground">
                        {t("cache", { ttl: e.cache })}
                      </span>
                    ) : null}
                  </div>
                  <h3 className="text-h3">{e.summary}</h3>
                  <p className="text-sm text-muted-foreground">{e.description}</p>
                </header>

                {e.params.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <caption className="sr-only">{t("parameters")}</caption>
                      <thead className="text-left text-caption text-muted-foreground">
                        <tr className="border-b">
                          <th scope="col" className="py-1 pr-3 font-medium">
                            {t("param")}
                          </th>
                          <th scope="col" className="py-1 pr-3 font-medium">
                            {t("in")}
                          </th>
                          <th scope="col" className="py-1 pr-3 font-medium">
                            {t("type")}
                          </th>
                          <th scope="col" className="py-1 font-medium">
                            {t("description")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {e.params.map((p) => (
                          <tr key={p.name} className="border-b last:border-b-0">
                            <td className="py-1 pr-3">
                              <code className="font-mono text-xs">{p.name}</code>
                              {p.required ? (
                                <span className="ml-1 text-[10px] text-destructive uppercase">
                                  {t("required")}
                                </span>
                              ) : null}
                            </td>
                            <td className="py-1 pr-3 text-xs text-muted-foreground">{p.in}</td>
                            <td className="py-1 pr-3 font-mono text-xs">
                              {Array.isArray(p.schema.enum)
                                ? (p.schema.enum as string[]).join(" | ")
                                : String(p.schema.type ?? "string")}
                              {p.schema.default !== undefined
                                ? ` = ${String(p.schema.default)}`
                                : ""}
                            </td>
                            <td className="py-1 text-xs text-muted-foreground">
                              {p.description ?? ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}

                {e.security === "stationApiKey" ? (
                  <p className="rounded-lg border border-l-4 border-l-brand bg-background px-3 py-2 text-sm">
                    <span className="font-medium">{t("auth")}: </span>
                    {t("security.stationApiKey")}
                  </p>
                ) : null}

                {e.requestBody ? (
                  <div className="flex flex-col gap-1">
                    <p className={label}>{t("requestBody")}</p>
                    <code className="font-mono text-xs text-muted-foreground">
                      {e.requestBody.contentType}
                    </code>
                    <SchemaTree schema={e.requestBody.schema} requiredLabel={t("required")} />
                  </div>
                ) : null}

                <div className="flex flex-col gap-1">
                  <p className={label}>{t("example")}</p>
                  <pre className="overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs">
                    <code>
                      {e.method === "POST"
                        ? [
                            `curl -X POST "${base}${e.example}" \\`,
                            `  -H "Authorization: Bearer <station-api-key>" \\`,
                            `  -H "Content-Type: application/json" \\`,
                            `  -d '${e.requestBody?.example ?? "[]"}'`,
                          ].join("\n")
                        : `curl "${base}${e.example}"`}
                    </code>
                  </pre>
                  {e.method === "GET" ? (
                    <a
                      href={e.example}
                      className="w-fit text-xs font-semibold text-brand hover:underline"
                    >
                      {t("try")} →
                    </a>
                  ) : null}
                </div>

                <div className="flex flex-col gap-3">
                  <p className={label}>{t("responsesTitle")}</p>
                  {e.responses.map((r) => (
                    <div key={`${r.status}-${r.contentType}`} className="flex flex-col gap-1">
                      <p className="text-sm">
                        <span className="num rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-xs font-semibold">
                          {r.status}
                        </span>
                        <code className="ml-2 font-mono text-xs text-muted-foreground">
                          {r.contentType}
                        </code>
                        <span className="ml-2 text-muted-foreground">
                          {t(r.descriptionKey as "responses.ok")}
                        </span>
                      </p>
                      {r.schema ? (
                        <SchemaTree schema={r.schema} requiredLabel={t("required")} />
                      ) : null}
                    </div>
                  ))}
                </div>
              </article>
            ))}
        </section>
      ))}

      <section className="text-sm text-muted-foreground">
        <p>{t("licenseNote")}</p>
        <p className="mt-2">{t("embedNote")}</p>
      </section>
    </div>
  );
}
