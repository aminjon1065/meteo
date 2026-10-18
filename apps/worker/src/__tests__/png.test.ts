import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { encodePng } from "../png";

describe("encodePng", () => {
  it("пишет корректную структуру PNG", () => {
    const rgba = new Uint8Array(2 * 2 * 4);
    rgba.set([255, 0, 0, 255], 0);
    rgba.set([0, 255, 0, 128], 4);
    const png = encodePng(2, 2, rgba);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(png.readUInt32BE(16)).toBe(2);
    expect(png.readUInt32BE(20)).toBe(2);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(6);
    const idatLen = png.readUInt32BE(33);
    expect(png.subarray(37, 41).toString("ascii")).toBe("IDAT");
    const raw = inflateSync(png.subarray(41, 41 + idatLen));
    expect(raw.length).toBe((2 * 4 + 1) * 2);
    expect([...raw.subarray(1, 5)]).toEqual([255, 0, 0, 255]);
    expect(png.subarray(png.length - 8, png.length - 4).toString("ascii")).toBe("IEND");
  });
  it("проверяет размер буфера", () => {
    expect(() => encodePng(2, 2, new Uint8Array(3))).toThrow();
  });
});
