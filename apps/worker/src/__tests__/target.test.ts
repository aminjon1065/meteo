import { describe, expect, it } from "vitest";
import {
  assertAllowedTarget,
  assertResolvedTargetAllowed,
  inOwnNetwork,
  isForbiddenHost,
} from "../station-pull/target";

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

describe("проверка после DNS и собственные сети контейнера", () => {
  // Интерфейсы worker'а в контейнере: сеть compose портала 172.18.0.0/16 и loopback.
  const interfaces = {
    lo: [
      {
        address: "127.0.0.1",
        netmask: "255.0.0.0",
        family: "IPv4" as const,
        mac: "00:00:00:00:00:00",
        internal: true,
        cidr: "127.0.0.1/8",
      },
    ],
    eth0: [
      {
        address: "172.18.0.5",
        netmask: "255.255.0.0",
        family: "IPv4" as const,
        mac: "02:42:ac:12:00:05",
        internal: false,
        cidr: "172.18.0.5/16",
      },
    ],
  };
  const dns: Record<string, string[]> = {
    postgres: ["172.18.0.2"],
    "station-pc": ["10.0.0.7"],
    "export.vendor.example": ["203.0.113.10"],
    "rebind.example": ["203.0.113.11", "127.0.0.1"],
    "metadata.example": ["169.254.169.254"],
  };
  const lookup = async (host: string) =>
    (dns[host] ?? []).map((address) => ({ address, family: 4 }));
  const check = { lookup, interfaces, blockOwnNetworks: true };

  it("inOwnNetwork: адрес в подсети интерфейса контейнера", () => {
    expect(inOwnNetwork("172.18.3.4", interfaces)).toBe(true);
    expect(inOwnNetwork("172.19.0.1", interfaces)).toBe(false);
    expect(inOwnNetwork("10.0.0.7", interfaces)).toBe(false);
    expect(inOwnNetwork("2001:db8::1", interfaces)).toBe(false);
  });

  it("сервисы Docker портала, loopback и метаданные облака после DNS запрещены", async () => {
    await expect(assertResolvedTargetAllowed("postgres", check)).rejects.toThrow(/172\.18\.0\.2/);
    await expect(assertResolvedTargetAllowed("rebind.example", check)).rejects.toThrow(
      /127\.0\.0\.1/,
    );
    await expect(assertResolvedTargetAllowed("metadata.example", check)).rejects.toThrow(
      /запрещён/,
    );
    await expect(assertResolvedTargetAllowed("172.18.0.9", check)).rejects.toThrow(/запрещён/);
  });

  it("серверы станций в сети Агентства и внешние адреса разрешены", async () => {
    await expect(assertResolvedTargetAllowed("station-pc", check)).resolves.toBeUndefined();
    await expect(
      assertResolvedTargetAllowed("export.vendor.example", check),
    ).resolves.toBeUndefined();
    await expect(assertResolvedTargetAllowed("192.168.1.20", check)).resolves.toBeUndefined();
  });

  it("вне контейнера собственные сети не проверяются (сеть сервера может совпасть с сетью станций)", async () => {
    await expect(
      assertResolvedTargetAllowed("postgres", { ...check, blockOwnNetworks: false }),
    ).resolves.toBeUndefined();
  });
});
