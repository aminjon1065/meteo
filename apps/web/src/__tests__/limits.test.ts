import { describe, expect, it } from "vitest";
import { rateLimitGroupFor, rateLimitKey } from "@/lib/security/limits";

describe("rateLimitGroupFor / rateLimitKey", () => {
  it("ingest — отдельная группа с лимитом по умолчанию 60 и ключом «станция + IP»", () => {
    const group = rateLimitGroupFor("/api/v1/ingest/DU-01");
    expect(group?.name).toBe("ingest");
    expect(group?.rule.limit).toBe(60);
    expect(
      rateLimitKey(group as NonNullable<typeof group>, "/api/v1/ingest/du-01", "1.2.3.4"),
    ).toBe("ingest:DU-01:1.2.3.4");
    expect(
      rateLimitKey(group as NonNullable<typeof group>, "/api/v1/ingest/%D0%A1%D0%A3-01", "::1"),
    ).toBe("ingest:СУ-01:::1");
  });
  it("публичный API и auth — как прежде; остальные пути без лимита", () => {
    expect(rateLimitGroupFor("/api/v1/stations")?.name).toBe("api");
    expect(rateLimitGroupFor("/api/v1/stations")?.rule.limit).toBe(120);
    expect(rateLimitGroupFor("/api/auth/get-session")?.name).toBe("auth");
    expect(rateLimitGroupFor("/api/admin/media")).toBeNull();
    expect(rateLimitGroupFor("/ru/air")).toBeNull();
    const api = rateLimitGroupFor("/api/v1/stations") as NonNullable<
      ReturnType<typeof rateLimitGroupFor>
    >;
    expect(rateLimitKey(api, "/api/v1/stations", "1.2.3.4")).toBe("api:1.2.3.4");
  });
});
