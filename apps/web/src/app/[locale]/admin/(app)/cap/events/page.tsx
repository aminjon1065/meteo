import { asc, count, eq, sql } from "@meteo/db";
import { capEventTranslations, capInfos } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { Button } from "@meteo/ui/components/button";
import { ArrowLeftIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EventDictionaryEditor } from "@/components/admin/cap/event-dictionary-editor";
import { Link } from "@/i18n/navigation";
import { getDb } from "@/lib/db";
import { requireAdminSession } from "@/lib/session";
import { deleteCapEvent, saveCapEvent } from "../actions";

export const dynamic = "force-dynamic";

export default async function CapEventsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = (await params) as { locale: Locale };
  setRequestLocale(locale);
  await requireAdminSession(locale, "alerts.manage");
  const db = getDb();
  const [t, rows] = await Promise.all([
    getTranslations("capAdmin"),
    db
      .select({
        id: capEventTranslations.id,
        event: capEventTranslations.event,
        name: capEventTranslations.name,
        uses: count(capInfos.id),
      })
      .from(capEventTranslations)
      .leftJoin(
        capInfos,
        eq(sql`lower(${capInfos.event})`, sql`lower(${capEventTranslations.event})`),
      )
      .groupBy(capEventTranslations.id)
      .orderBy(asc(capEventTranslations.event)),
  ]);

  async function save(raw: unknown) {
    "use server";
    return saveCapEvent(locale, raw);
  }
  async function remove(id: number) {
    "use server";
    return deleteCapEvent(locale, id);
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("events")}</h1>
          <p className="max-w-3xl text-muted-foreground">{t("eventsSubtitle")}</p>
        </div>
        <Button variant="outline" render={<Link href="/admin/cap" />} nativeButton={false}>
          <ArrowLeftIcon aria-hidden="true" />
          {t("back")}
        </Button>
      </div>
      <EventDictionaryEditor rows={rows} save={save} remove={remove} />
    </>
  );
}
