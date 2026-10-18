import { can } from "@meteo/core";
import { eq } from "@meteo/db";
import { stationPollutants, stations } from "@meteo/db/schema";
import type { Locale } from "@meteo/i18n";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { StationDangerZone } from "@/components/admin/stations/station-danger-zone";
import { StationForm } from "@/components/admin/stations/station-form";
import { StationStatusBadge } from "@/components/admin/stations/station-status-badge";
import { getDb } from "@/lib/db";
import { name } from "@/lib/format";
import { requireAdminSession } from "@/lib/session";
import type { StationInput } from "@/lib/validation/station";
import { loadStationFormOptions } from "../_data";
import { decommissionStation, rotateStationApiKey, updateStation } from "../actions";

export const dynamic = "force-dynamic";

export default async function EditStationPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id: rawId } = (await params) as { locale: Locale; id: string };
  setRequestLocale(locale);
  const session = await requireAdminSession(locale, "stations.read");
  const id = Number(rawId);
  if (!Number.isInteger(id)) notFound();
  const db = getDb();
  const station = await db.query.stations.findFirst({ where: eq(stations.id, id) });
  if (!station) notFound();
  const [t, options, pollutantRows] = await Promise.all([
    getTranslations("stations"),
    loadStationFormOptions(),
    db.select().from(stationPollutants).where(eq(stationPollutants.stationId, id)),
  ]);
  const canWrite = can(session.user.role, "stations.write");

  const initial: Partial<StationInput> & { id: number } = {
    id: station.id,
    code: station.code,
    slug: station.slug,
    name: { tg: station.name.tg ?? "", ru: station.name.ru ?? "", en: station.name.en ?? "" },
    description: {
      tg: station.description?.tg ?? "",
      ru: station.description?.ru ?? "",
      en: station.description?.en ?? "",
    },
    address: {
      tg: station.address?.tg ?? "",
      ru: station.address?.ru ?? "",
      en: station.address?.en ?? "",
    },
    kind: station.kind,
    status: station.status,
    lat: station.geom.y,
    lon: station.geom.x,
    elevationM: (station.elevationM ?? "") as unknown as number,
    regionId: (station.regionId ?? "") as unknown as number,
    districtId: (station.districtId ?? "") as unknown as number,
    commissionedAt: station.commissionedAt ?? "",
    decommissionedAt: station.decommissionedAt ?? "",
    dataSource: station.dataSource,
    sampling: station.sampling,
    isPublic: station.isPublic,
    pollutants: pollutantRows.map((p) => ({
      pollutantId: p.pollutantId,
      inputUnit: p.inputUnit as "µg/m³",
      active: p.active,
    })),
  };

  async function action(raw: StationInput) {
    "use server";
    return updateStation(locale, id, raw);
  }
  async function decommission(date: string) {
    "use server";
    return decommissionStation(locale, id, date);
  }
  async function rotateKey() {
    "use server";
    return rotateStationApiKey(locale, id);
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {name(station.name, locale) || station.code}
          </h1>
          <p className="font-mono text-sm text-muted-foreground">
            {station.code} · {station.slug}
          </p>
        </div>
        <StationStatusBadge status={station.status} label={t(`status.${station.status}`)} />
      </div>
      {canWrite ? (
        <>
          <StationForm options={options} initial={initial} action={action} />
          <StationDangerZone
            status={station.status}
            hasApiKey={Boolean(station.apiKeyHash)}
            decommission={decommission}
            rotateKey={rotateKey}
          />
        </>
      ) : (
        <p className="text-muted-foreground">{t("readOnly")}</p>
      )}
    </>
  );
}
