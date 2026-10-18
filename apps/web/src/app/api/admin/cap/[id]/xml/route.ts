import { can } from "@meteo/core";
import { eq } from "@meteo/db";
import { capAlerts } from "@meteo/db/schema";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET /api/admin/cap/{id}/xml — исходный XML любого сообщения (включая Test/Exercise), только для админов. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(session.user.role, "alerts.manage"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  const alertId = Number(id);
  if (!Number.isInteger(alertId)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const row = await getDb().query.capAlerts.findFirst({ where: eq(capAlerts.id, alertId) });
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(row.rawXml, {
    headers: {
      "Content-Type": "application/cap+xml; charset=utf-8",
      "Content-Disposition": `inline; filename="${row.identifier.replace(/[^\w.-]+/g, "_")}.xml"`,
      "Cache-Control": "private, no-store",
    },
  });
}
