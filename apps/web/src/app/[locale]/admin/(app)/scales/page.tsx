import { asc } from "@meteo/db";
import { indexScales } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { Badge } from "@meteo/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@meteo/ui/components/card";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { requireAdminSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function ScalesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdminSession(locale, "scales.write");
  const [t, scales] = await Promise.all([
    getTranslations("scales"),
    getDb().select().from(indexScales).orderBy(asc(indexScales.sortOrder)),
  ]);
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {scales.map((sc) => (
          <Link key={sc.id} href={`/admin/scales/${sc.id}`} className="group">
            <Card className="h-full transition-colors group-hover:bg-accent/40">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  {name(sc.name, locale) || sc.code}
                  {sc.isDefaultPublic ? <Badge>{t("default")}</Badge> : null}
                  {!sc.enabled ? <Badge variant="secondary">{t("disabled")}</Badge> : null}
                </CardTitle>
                <CardDescription>
                  <span className="font-mono text-xs">{sc.code}</span> · {t(`kind.${sc.kind}`)}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                {name(sc.description, locale)}
              </CardContent>
            </Card>
          </Link>
        ))}
        <Link href="/admin/scales/limits" className="group">
          <Card className="h-full border-dashed transition-colors group-hover:bg-accent/40">
            <CardHeader>
              <CardTitle className="text-base">{t("limits.title")}</CardTitle>
              <CardDescription>{t("limits.subtitle")}</CardDescription>
            </CardHeader>
          </Card>
        </Link>
      </div>
    </>
  );
}
