import { describe, expect, it } from "vitest";
import { safeAdminNext } from "@/lib/security/redirects";

describe("safeAdminNext", () => {
  it("пропускает только внутренние пути админки", () => {
    expect(safeAdminNext("/admin")).toBe("/admin");
    expect(safeAdminNext("/ru/admin/stations/5?tab=sources")).toBe(
      "/ru/admin/stations/5?tab=sources",
    );
    expect(safeAdminNext("/en/admin/two-factor")).toBe("/en/admin/two-factor");
  });
  it("отбрасывает открытые редиректы и чужие пути", () => {
    expect(safeAdminNext("//evil.example/admin")).toBeUndefined();
    expect(safeAdminNext("/\\evil.example/admin")).toBeUndefined();
    expect(safeAdminNext("https://evil.example/admin")).toBeUndefined();
    expect(safeAdminNext("/admin\u0000.evil")).toBeUndefined();
    expect(safeAdminNext("/administrator")).toBeUndefined();
    expect(safeAdminNext("/ru/news")).toBeUndefined();
    expect(safeAdminNext("")).toBeUndefined();
    expect(safeAdminNext(undefined)).toBeUndefined();
  });
});
