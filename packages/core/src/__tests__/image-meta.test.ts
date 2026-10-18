import { describe, expect, it } from "vitest";
import { ALLOWED_UPLOAD_MIMES, detectFileType, MAX_UPLOAD_BYTES } from "../image-meta";

/** Собирает Uint8Array из ASCII-строк и списков байт. */
function bytes(...parts: Array<string | number[]>): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === "string") {
      for (let i = 0; i < p.length; i++) out.push(p.charCodeAt(i));
    } else {
      out.push(...p);
    }
  }
  return Uint8Array.from(out);
}

const PNG_120x80 = bytes(
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  [0x00, 0x00, 0x00, 0x0d],
  "IHDR",
  [0x00, 0x00, 0x00, 0x78], // ширина 120
  [0x00, 0x00, 0x00, 0x50], // высота 80
  [0x08, 0x06, 0x00, 0x00, 0x00],
  [0xde, 0xad, 0xbe, 0xef], // CRC (не проверяется)
);

const JPEG_640x480 = bytes(
  [0xff, 0xd8],
  [0xff, 0xe0, 0x00, 0x10], // APP0, длина 16
  "JFIF\0",
  [0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00],
  [0xff, 0xff], // байты-заполнители перед маркером
  [0xff, 0xdb, 0x00, 0x04, 0x00, 0x00], // DQT (укороченный)
  [0xff, 0xc0, 0x00, 0x11, 0x08], // SOF0, длина 17, точность 8
  [0x01, 0xe0], // высота 480
  [0x02, 0x80], // ширина 640
  [0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01],
  [0xff, 0xda, 0x00, 0x08], // SOS
);

const GIF_10x20 = bytes("GIF89a", [0x0a, 0x00, 0x14, 0x00, 0xf7, 0x00, 0x00]);

const WEBP_VP8X_300x200 = bytes(
  "RIFF",
  [0x1e, 0x00, 0x00, 0x00],
  "WEBP",
  "VP8X",
  [0x0a, 0x00, 0x00, 0x00],
  [0x08, 0x00, 0x00, 0x00], // флаги + reserved
  [0x2b, 0x01, 0x00], // ширина − 1 = 299
  [0xc7, 0x00, 0x00], // высота − 1 = 199
);

const WEBP_VP8L_16x8 = bytes(
  "RIFF",
  [0x10, 0x00, 0x00, 0x00],
  "WEBP",
  "VP8L",
  [0x05, 0x00, 0x00, 0x00],
  [0x2f], // сигнатура VP8L
  [0x0f, 0xc0, 0x01, 0x00], // 14 бит ширина−1 = 15, 14 бит высота−1 = 7
);

const WEBP_VP8_550x368 = bytes(
  "RIFF",
  [0x1a, 0x00, 0x00, 0x00],
  "WEBP",
  "VP8 ",
  [0x0e, 0x00, 0x00, 0x00],
  [0x10, 0x02, 0x00], // тег кадра
  [0x9d, 0x01, 0x2a], // стартовый код
  [0x26, 0x02], // ширина 550 (LE, 14 бит)
  [0x70, 0x01], // высота 368
);

describe("detectFileType: поддерживаемые форматы", () => {
  it("PNG с размерами из IHDR", () => {
    expect(detectFileType(PNG_120x80)).toEqual({
      mime: "image/png",
      ext: "png",
      width: 120,
      height: 80,
    });
  });

  it("JPEG: обходит APP0/DQT и читает SOF0", () => {
    expect(detectFileType(JPEG_640x480)).toEqual({
      mime: "image/jpeg",
      ext: "jpg",
      width: 640,
      height: 480,
    });
    // прогрессивный JPEG: SOF2
    const progressive = Uint8Array.from(JPEG_640x480);
    const sofIdx = progressive.findIndex((b, i) => b === 0xc0 && progressive[i - 1] === 0xff);
    progressive[sofIdx] = 0xc2;
    expect(detectFileType(progressive)?.width).toBe(640);
    // DHT (C4) не считается SOF — размеры берутся из настоящего SOF0 после него
    const withDht = bytes(
      [0xff, 0xd8],
      [0xff, 0xc4, 0x00, 0x04, 0x00, 0x00],
      [0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x20, 0x01, 0x01, 0x11, 0x00],
    );
    expect(detectFileType(withDht)).toMatchObject({ mime: "image/jpeg", width: 32, height: 16 });
  });

  it("JPEG без SOF в переданном префиксе — тип известен, размеры нет", () => {
    const truncated = JPEG_640x480.slice(0, 20);
    expect(detectFileType(truncated)).toEqual({
      mime: "image/jpeg",
      ext: "jpg",
      width: null,
      height: null,
    });
    expect(detectFileType(bytes([0xff, 0xd8, 0xff]))?.mime).toBe("image/jpeg");
  });

  it("GIF с размерами LE", () => {
    expect(detectFileType(GIF_10x20)).toEqual({
      mime: "image/gif",
      ext: "gif",
      width: 10,
      height: 20,
    });
    expect(detectFileType(bytes("GIF87a", [0x01, 0x00, 0x02, 0x00]))?.width).toBe(1);
  });

  it("WebP: VP8X, VP8L и VP8", () => {
    expect(detectFileType(WEBP_VP8X_300x200)).toEqual({
      mime: "image/webp",
      ext: "webp",
      width: 300,
      height: 200,
    });
    expect(detectFileType(WEBP_VP8L_16x8)).toEqual({
      mime: "image/webp",
      ext: "webp",
      width: 16,
      height: 8,
    });
    expect(detectFileType(WEBP_VP8_550x368)).toEqual({
      mime: "image/webp",
      ext: "webp",
      width: 550,
      height: 368,
    });
    // неизвестный первый чанк — тип есть, размеров нет
    expect(detectFileType(bytes("RIFF", [0, 0, 0, 0], "WEBP", "ALPH", [0, 0, 0, 0]))).toEqual({
      mime: "image/webp",
      ext: "webp",
      width: null,
      height: null,
    });
  });

  it("PDF без размеров", () => {
    expect(detectFileType(bytes("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n1 0 obj"))).toEqual({
      mime: "application/pdf",
      ext: "pdf",
      width: null,
      height: null,
    });
  });
});

describe("detectFileType: отрицательные случаи", () => {
  it("пустой массив и мусор", () => {
    expect(detectFileType(new Uint8Array(0))).toBeNull();
    const random = Uint8Array.from({ length: 64 }, (_, i) => (i * 7919 + 13) % 251);
    expect(detectFileType(random)).toBeNull();
    expect(detectFileType(bytes([0x89]))).toBeNull();
    expect(detectFileType(bytes([0xff]))).toBeNull();
    expect(detectFileType(bytes("RIFF", [0, 0, 0, 0], "WAVE"))).toBeNull();
    expect(detectFileType(bytes("GIF"))).toBeNull();
  });

  it("SVG и текст не принимаются", () => {
    expect(detectFileType(bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(detectFileType(bytes('<?xml version="1.0"?><svg/>'))).toBeNull();
    expect(detectFileType(bytes("%PD"))).toBeNull();
  });

  it("обрезанный PNG — null, а не исключение", () => {
    expect(detectFileType(PNG_120x80.slice(0, 8))).toBeNull();
    expect(detectFileType(PNG_120x80.slice(0, 16))).toBeNull();
    expect(detectFileType(PNG_120x80.slice(0, 22))).toBeNull();
    expect(detectFileType(PNG_120x80.slice(0, 24))?.height).toBe(80);
  });

  it("не бросает на коротких префиксах любого формата", () => {
    for (const sample of [PNG_120x80, JPEG_640x480, GIF_10x20, WEBP_VP8X_300x200, WEBP_VP8L_16x8]) {
      for (let n = 0; n <= sample.length; n++) {
        expect(() => detectFileType(sample.slice(0, n))).not.toThrow();
      }
    }
  });
});

describe("константы загрузки", () => {
  it("пять разрешённых MIME и лимит 10 МБ", () => {
    expect(ALLOWED_UPLOAD_MIMES).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "application/pdf",
    ]);
    expect(MAX_UPLOAD_BYTES).toBe(10_485_760);
  });
});
