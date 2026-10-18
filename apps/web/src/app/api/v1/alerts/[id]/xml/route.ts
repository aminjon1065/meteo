import { and, eq } from "@meteo/db";
import { capAlerts } from "@meteo/db/schema";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GET /api/v1/alerts/{id}/xml — исходное CAP‑сообщение (только status=Actual). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const alertId = Number(id);
  if (!Number.isInteger(alertId)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const rows = await getDb()
    .select({ identifier: capAlerts.identifier, rawXml: capAlerts.rawXml })
    .from(capAlerts)
    .where(and(eq(capAlerts.id, alertId), eq(capAlerts.status, "Actual")))
    .limit(1);
  const row = rows[0];
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(row.rawXml, {
    headers: {
      "Content-Type": "application/cap+xml; charset=utf-8",
      "Content-Disposition": `inline; filename="${row.identifier.replace(/[^\w.-]+/g, "_")}.xml"`,
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
