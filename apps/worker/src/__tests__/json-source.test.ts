import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { fetchJsonDocument } from "../station-pull/clients";
import { httpHeaders } from "../station-pull/shared";
import { assertAllowedTarget, ForbiddenTargetError } from "../station-pull/target";

const dir = mkdtempSync(join(tmpdir(), "meteo-json-"));
const opts = { headers: {}, timeoutMs: 1000, maxBytes: 1024 };

describe("fetchJsonDocument (file://)", () => {
  it("читает сохранённый ответ только при allowFile", async () => {
    const file = join(dir, "stations.json");
    writeFileSync(file, JSON.stringify([{ stationID: "A", PM25: 1 }]));
    const url = pathToFileURL(file).toString();
    await expect(fetchJsonDocument(url, opts)).rejects.toBeInstanceOf(ForbiddenTargetError);
    const { body, bytes } = await fetchJsonDocument(url, { ...opts, allowFile: true });
    expect(body).toEqual([{ stationID: "A", PM25: 1 }]);
    expect(bytes).toBeGreaterThan(0);
  });
  it("ограничивает размер и требует JSON", async () => {
    const big = join(dir, "big.json");
    writeFileSync(big, `[${"1,".repeat(2000)}1]`);
    await expect(
      fetchJsonDocument(pathToFileURL(big).toString(), { ...opts, allowFile: true }),
    ).rejects.toThrow(/слишком большой/);
    const bad = join(dir, "bad.json");
    writeFileSync(bad, "{not json");
    await expect(
      fetchJsonDocument(pathToFileURL(bad).toString(), { ...opts, allowFile: true }),
    ).rejects.toThrow(/не является JSON/);
  });
});

describe("JSON API: адреса и заголовки", () => {
  it("тип json проверяется как http: только http(s) и разрешённый хост", () => {
    expect(() =>
      assertAllowedTarget("json", "https://wwcs.tj/services/airquality/stations"),
    ).not.toThrow();
    expect(() => assertAllowedTarget("json", "http://127.0.0.1:3000/x")).toThrow(
      ForbiddenTargetError,
    );
    expect(() => assertAllowedTarget("json", "file:///etc/passwd")).toThrow(ForbiddenTargetError);
  });
  it("Basic при логине и пароле, Bearer при одном токене", () => {
    expect(httpHeaders("u", "p", "application/json").authorization).toBe(
      `Basic ${Buffer.from("u:p").toString("base64")}`,
    );
    expect(httpHeaders(null, "tok", "application/json").authorization).toBe("Bearer tok");
    expect(httpHeaders(null, null, "application/json").authorization).toBeUndefined();
  });
});
