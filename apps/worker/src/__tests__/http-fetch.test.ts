import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSourceUrl, MAX_REDIRECTS } from "../station-pull/http-fetch";

const dns: Record<string, string[]> = {
  "vendor.example": ["203.0.113.10"],
  "cdn.example": ["203.0.113.20"],
  "internal.example": ["172.18.0.2"],
};
const check = {
  lookup: async (host: string) => (dns[host] ?? []).map((address) => ({ address, family: 4 })),
  interfaces: {
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
  },
  blockOwnNetworks: true,
};
const retry = { retries: 0, timeoutMs: 5_000, label: "test" };

function redirect(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchSourceUrl", () => {
  it("редирект на адрес метаданных облака отклоняется до запроса к нему", async () => {
    const fetchMock = vi.fn(async () => redirect("http://169.254.169.254/latest/meta-data/"));
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchSourceUrl("http", "https://vendor.example/feed.csv", {}, retry, check),
    ).rejects.toThrow(/запрещён/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("редирект на имя, ведущее во внутреннюю сеть портала, отклоняется", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => redirect("http://internal.example:3001/healthz")),
    );
    await expect(
      fetchSourceUrl("json", "https://vendor.example/api", {}, retry, check),
    ).rejects.toThrow(/172\.18\.0\.2/);
  });

  it("разрешённый редирект проходит; на другой домен логин и пароль не уходят", async () => {
    const seen: Array<{ url: string; auth: string | null; redirect?: RequestInit["redirect"] }> =
      [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seen.push({
          url,
          auth: new Headers(init.headers).get("authorization"),
          redirect: init.redirect,
        });
        return seen.length === 1
          ? redirect("https://cdn.example/files/feed.csv", 301)
          : new Response("time,pm25\n", { status: 200 });
      }),
    );
    const { res, url } = await fetchSourceUrl(
      "http",
      "https://vendor.example/feed.csv",
      { headers: { authorization: "Basic dXNlcjpwYXNz" } },
      retry,
      check,
    );
    expect(res.status).toBe(200);
    expect(url).toBe("https://cdn.example/files/feed.csv");
    expect(seen.map((s) => s.redirect)).toEqual(["manual", "manual"]);
    expect(seen[0]?.auth).toBe("Basic dXNlcjpwYXNz");
    expect(seen[1]?.auth).toBeNull();
  });

  it("на тот же origin заголовок авторизации сохраняется, цепочка ограничена", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return redirect(`/step-${calls}`);
      }),
    );
    await expect(
      fetchSourceUrl("http", "https://vendor.example/start", {}, retry, check),
    ).rejects.toThrow(/перенаправлений/);
    expect(calls).toBe(MAX_REDIRECTS + 1);
  });
});
