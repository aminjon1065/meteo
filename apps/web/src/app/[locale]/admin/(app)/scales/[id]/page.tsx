import { eq } from "@meteo/db";
import { indexBreakpoints, indexScales } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ScaleEditor } from "@/components/admin/scales/scale-editor";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { requireAdminSession } from "@/lib/session";
import { listPollutants, saveScale } from "../actions";

export const dynamic = "force-dynamic";

export default async function ScaleEditPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id: rawId } = (await params) as { locale: Locale; id: string };
  setRequestLocale(locale);
  await requireAdminSession(locale, "scales.write");
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();
  const scale = await db.query.indexScales.findFirst({ where: eq(indexScales.id, id) });
  if (!scale) notFound();
  const [t, breakpoints, pollutants] = await Promise.all([
    getTranslations("scales"),
    db.select().from(indexBreakpoints).where(eq(indexBreakpoints.scaleId, id)),
    listPollutants(),
  ]);
  async function action(raw: unknown) {
    "use server";
    return saveScale(locale, id, raw);
  }
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {name(scale.name, locale) || scale.code}
        </h1>
        <p className="font-mono text-sm text-muted-foreground">
          {scale.code} · {t(`kind.${scale.kind}`)}
        </p>
      </div>
      <ScaleEditor
        scale={{
          id: scale.id,
          kind: scale.kind,
          name: scale.name,
          description: scale.description,
          isDefaultPublic: scale.isDefaultPublic,
          enabled: scale.enabled,
          sortOrder: scale.sortOrder,
          levels: scale.levels,
        }}
        breakpoints={breakpoints.map((b) => ({
          pollutantId: b.pollutantId,
          level: b.level,
          lo: b.lo,
          hi: b.hi,
          averagingMin: b.averagingMin,
        }))}
        pollutants={pollutants}
        action={action}
      />
    </>
  );
}
