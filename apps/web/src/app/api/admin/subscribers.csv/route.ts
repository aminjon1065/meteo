import { can } from "@meteo/core";
import { desc } from "@meteo/db";
import { subscribers } from "@meteo/db/schema";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Экспорт подписчиков (CSV) — только для роли с правом subscribers.manage. */
export async function GET() {
  const session = await getSession();
  if (!session || !can(session.user.role, "subscribers.manage"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const rows = await getDb().select().from(subscribers).orderBy(desc(subscribers.createdAt));
  const lines = ["email,locale,status,all,stations,regions,newsletter,confirmed_at,created_at"];
  for (const s of rows) {
    lines.push(
      [
        s.email,
        s.locale,
        s.status,
        s.topics.all ? "1" : "0",
        (s.topics.stations ?? []).join(";"),
        (s.topics.regions ?? []).join(";"),
        s.topics.newsletter ? "1" : "0",
        s.confirmedAt?.toISOString() ?? "",
        s.createdAt.toISOString(),
      ]
        .map((v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v))
        .join(","),
    );
  }
  return new NextResponse(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="subscribers.csv"',
    },
  });
}
