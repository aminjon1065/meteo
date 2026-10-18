import { describe, expect, it } from "vitest";
import {
  isSealedSecret,
  openSecret,
  resolveStoredSecret,
  sealSecret,
  secretKeyFromEnv,
} from "../secret-box";

const KEY = "0123456789abcdef0123456789abcdef";

describe("secret-box", () => {
  it("шифрует и расшифровывает, каждый раз новый IV", () => {
    const a = sealSecret("p@ss:word/слово", KEY);
    const b = sealSecret("p@ss:word/слово", KEY);
    expect(a).not.toBe(b);
    expect(isSealedSecret(a)).toBe(true);
    expect(openSecret(a, KEY)).toBe("p@ss:word/слово");
    expect(openSecret(b, KEY)).toBe("p@ss:word/слово");
  });
  it("другой ключ или повреждение → понятная ошибка", () => {
    const sealed = sealSecret("secret", KEY);
    expect(() => openSecret(sealed, `${KEY}x`)).toThrow(/ключ/);
    const [head, tag, data] = sealed.split(".") as [string, string, string];
    const flipped = tag.startsWith("A") ? `B${tag.slice(1)}` : `A${tag.slice(1)}`;
    expect(() => openSecret(`${head}.${flipped}.${data}`, KEY)).toThrow(/ключ/);
    expect(() => openSecret("enc:v1:broken", KEY)).toThrow(/формат/);
    expect(() => openSecret("plain", KEY)).toThrow(/не зашифровано/);
    expect(() => sealSecret("x", "short")).toThrow(/16/);
  });
  it("resolveStoredSecret: env:, enc:v1: и открытый текст", () => {
    expect(resolveStoredSecret(null, KEY)).toBeNull();
    expect(resolveStoredSecret("env:FTP_PASS", KEY, { FTP_PASS: "from-env" })).toBe("from-env");
    expect(() => resolveStoredSecret("env:FTP_PASS", KEY, {})).toThrow(/FTP_PASS/);
    expect(resolveStoredSecret(sealSecret("x", KEY), KEY)).toBe("x");
    expect(() => resolveStoredSecret(sealSecret("x", KEY), null)).toThrow(/STATION_SOURCES_KEY/);
    expect(resolveStoredSecret("plain", null)).toBe("plain");
    expect(secretKeyFromEnv({ BETTER_AUTH_SECRET: "b" })).toBe("b");
    expect(secretKeyFromEnv({ STATION_SOURCES_KEY: "s", BETTER_AUTH_SECRET: "b" })).toBe("s");
    expect(secretKeyFromEnv({})).toBeNull();
  });
});
