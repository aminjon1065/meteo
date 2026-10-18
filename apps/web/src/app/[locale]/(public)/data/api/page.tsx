import type { Locale } from "@meteo/i18n";
import { Badge } from "@meteo/ui/components/badge";
import { CodeIcon, DownloadIcon } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SchemaTree } from "@/components/data/schema-tree";
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

/** Документация публичного API, собранная из OpenAPI‑документа (Zod‑схемы). */
export default async function ApiDocsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  const t = await getTranslations("apiDocs");
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const endpoints = listEndpoints((key, values) => t(key as "title", values));
  const tags = [...new Set(endpoints.map((e) => e.tag))];

  return (
    <div className="container-page flex flex-col gap-8 py-10">
      <div className="flex flex-col gap-3">
        <h1 className="flex items-center gap-3 text-3xl font-semibold tracking-tight">
          <CodeIcon className="size-8 text-brand" aria-hidden="true" />
          {t("title")}
        </h1>
        <p className="max-w-3xl text-muted-foreground">{t("intro")}</p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <a
            href={`/api/v1/openapi.json?lang=${locale}`}
            className="inline-flex items-center gap-1 rounded-md border bg-card px-3 py-1.5 font-medium hover:bg-accent"
          >
            <DownloadIcon className="size-4" aria-hidden="true" />
            {t("download")}
          </a>
          <Link href="/data" className="text-muted-foreground underline-offset-4 hover:underline">
            {t("backToData")}
          </Link>
        </div>
      </div>

      <section className="grid gap-4 rounded-xl border bg-card p-5 text-sm md:grid-cols-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase">{t("baseUrl")}</p>
          <code className="font-mono text-xs break-all">{base}</code>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase">{t("auth")}</p>
          <p>{t("authHint")}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground uppercase">{t("cors")}</p>
          <p>{t("corsHint")}</p>
        </div>
      </section>

      <nav aria-label={t("contents")} className="flex flex-wrap gap-2 text-sm">
        {endpoints.map((e) => (
          <a
            key={e.id}
            href={`#${e.id}`}
            className="rounded-full border bg-card px-3 py-1 font-mono text-xs hover:bg-accent"
          >
            {e.path}
          </a>
        ))}
      </nav>

      {tags.map((tag) => (
        <section key={tag} className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">{t(`tags.${tag}` as "tags.air")}</h2>
          {endpoints
            .filter((e) => e.tag === tag)
            .map((e) => (
              <article
                key={e.id}
                id={e.id}
                className="flex flex-col gap-4 rounded-xl border bg-card p-5 scroll-mt-20"
              >
                <header className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{e.method}</Badge>
                    <code className="font-mono text-sm break-all">{e.path}</code>
                    {e.cache ? (
                      <span className="text-xs text-muted-foreground">
                        {t("cache", { ttl: e.cache })}
                      </span>
                    ) : null}
                  </div>
                  <h3 className="text-lg font-semibold">{e.summary}</h3>
                  <p className="text-sm text-muted-foreground">{e.description}</p>
                </header>

                {e.params.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <caption className="sr-only">{t("parameters")}</caption>
                      <thead className="text-left text-xs text-muted-foreground">
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
                  <p className="rounded-lg border border-brand/30 bg-brand/5 p-3 text-sm">
                    <span className="font-medium">{t("auth")}: </span>
                    {t("security.stationApiKey")}
                  </p>
                ) : null}

                {e.requestBody ? (
                  <div className="flex flex-col gap-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase">
                      {t("requestBody")}
                    </p>
                    <code className="font-mono text-xs text-muted-foreground">
                      {e.requestBody.contentType}
                    </code>
                    <SchemaTree schema={e.requestBody.schema} requiredLabel={t("required")} />
                  </div>
                ) : null}

                <div className="flex flex-col gap-1">
                  <p className="text-xs font-medium text-muted-foreground uppercase">
                    {t("example")}
                  </p>
                  <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
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
                      className="w-fit text-xs text-brand underline-offset-4 hover:underline"
                    >
                      {t("try")}
                    </a>
                  ) : null}
                </div>

                <div className="flex flex-col gap-3">
                  <p className="text-xs font-medium text-muted-foreground uppercase">
                    {t("responsesTitle")}
                  </p>
                  {e.responses.map((r) => (
                    <div key={`${r.status}-${r.contentType}`} className="flex flex-col gap-1">
                      <p className="text-sm">
                        <Badge variant={r.status === 200 ? "secondary" : "outline"}>
                          {r.status}
                        </Badge>
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

      <section className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
        <p>{t("licenseNote")}</p>
        <p className="mt-2">{t("embedNote")}</p>
      </section>
    </div>
  );
}
