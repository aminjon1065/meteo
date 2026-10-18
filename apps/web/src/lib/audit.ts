import "server-only";
import { auditLog } from "@meteo/db/schema";
import { headers } from "next/headers";
import type { Session } from "./auth";
import { getDb } from "./db";

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
}

/** Запись в журнал аудита (append-only). Вызывается из server actions после успешной мутации. */
export async function recordAudit(session: Session, entry: AuditEntry): Promise<void> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  await getDb()
    .insert(auditLog)
    .values({
      actorId: session.user.id,
      actorEmail: session.user.email,
      actorRole: session.user.role ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId:
        entry.entityId === undefined || entry.entityId === null ? null : String(entry.entityId),
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: forwarded?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null,
      userAgent: h.get("user-agent"),
      requestId: h.get("x-request-id"),
    });
}
