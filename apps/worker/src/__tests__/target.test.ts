import { describe, expect, it } from "vitest";
import { assertAllowedTarget, isForbiddenHost } from "../station-pull/target";

describe("isForbiddenHost", () => {
  it("запрещает loopback, link-local, нулевой адрес и служебные зоны", () => {
    for (const h of [
      "localhost",
      "LOCALHOST",
      "web.localhost",
      "redis.internal",
      "127.0.0.1",
      "127.1.2.3",
      "0.0.0.0",
      "169.254.169.254",
      "224.0.0.1",
      "::1",
      "::",
      "[::1]",
      "fe80::1",
      "::ffff:127.0.0.1",
      "",
    ])
      expect(isForbiddenHost(h), h).toBe(true);
  });
  it("разрешает публичные и частные адреса станций", () => {
    for (const h of [
      "export.vendor.example",
      "192.168.1.20",
      "10.0.0.5",
      "172.16.3.1",
      "8.8.8.8",
      "2001:db8::1",
      "station-pc",
    ])
      expect(isForbiddenHost(h), h).toBe(false);
  });
});

describe("assertAllowedTarget", () => {
  it("http: только http(s) и разрешённый хост", () => {
    expect(() => assertAllowedTarget("http", "https://vendor.example/export.csv")).not.toThrow();
    expect(() => assertAllowedTarget("http", "http://127.0.0.1:3000/api")).toThrow(/запрещён/);
    expect(() => assertAllowedTarget("http", "http://[::1]/x")).toThrow(/запрещён/);
    expect(() => assertAllowedTarget("http", "file:///etc/passwd")).toThrow(/запрещён/);
    expect(() => assertAllowedTarget("http", "not a url")).toThrow(/запрещён/);
  });
  it("sftp/ftp: проверяется host", () => {
    expect(() => assertAllowedTarget("sftp", "sftp.vendor.example")).not.toThrow();
    expect(() => assertAllowedTarget("ftp", "169.254.10.1")).toThrow(/запрещён/);
  });
});
