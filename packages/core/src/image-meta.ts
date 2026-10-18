/**
 * Определение типа загружаемого файла по магическим байтам и чтение размеров
 * изображения из заголовка. MIME, присланному клиентом, не доверяем: тип берётся
 * только из содержимого. Функции чистые и никогда не бросают исключений на
 * коротком или мусорном вводе — в таком случае возвращается null.
 */

export const ALLOWED_UPLOAD_MIMES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/pdf",
] as const;
export type UploadMime = (typeof ALLOWED_UPLOAD_MIMES)[number];

export type UploadExt = "png" | "jpg" | "webp" | "gif" | "pdf";

/** Лимит размера загружаемого файла, байт (10 МБ). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export interface FileTypeInfo {
  mime: UploadMime;
  ext: UploadExt;
  /** Ширина в пикселях; null для PDF и если заголовок обрезан. */
  width: number | null;
  height: number | null;
}

/* ------------------------------------------------------------------ */
/* Чтение чисел с проверкой границ                                     */
/* ------------------------------------------------------------------ */

function u8(b: Uint8Array, off: number): number | null {
  const v = b[off];
  return v === undefined ? null : v;
}

function u16be(b: Uint8Array, off: number): number | null {
  const hi = u8(b, off);
  const lo = u8(b, off + 1);
  return hi === null || lo === null ? null : (hi << 8) | lo;
}

function u16le(b: Uint8Array, off: number): number | null {
  const lo = u8(b, off);
  const hi = u8(b, off + 1);
  return hi === null || lo === null ? null : (hi << 8) | lo;
}

function u24le(b: Uint8Array, off: number): number | null {
  const b0 = u8(b, off);
  const b1 = u8(b, off + 1);
  const b2 = u8(b, off + 2);
  return b0 === null || b1 === null || b2 === null ? null : b0 | (b1 << 8) | (b2 << 16);
}

function u32be(b: Uint8Array, off: number): number | null {
  const hi = u16be(b, off);
  const lo = u16be(b, off + 2);
  // >>> 0 — чтобы старший бит не дал отрицательное число
  return hi === null || lo === null ? null : ((hi << 16) | lo) >>> 0;
}

function hasAscii(b: Uint8Array, off: number, text: string): boolean {
  if (b.length < off + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (b[off + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

function hasBytes(b: Uint8Array, off: number, sig: readonly number[]): boolean {
  if (b.length < off + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (b[off + i] !== sig[i]) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Форматы                                                             */
/* ------------------------------------------------------------------ */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** PNG: подпись 8 байт, затем обязательный первый чанк IHDR с шириной/высотой (BE). */
function detectPng(b: Uint8Array): FileTypeInfo | null {
  if (!hasBytes(b, 0, PNG_SIGNATURE)) return null;
  // без IHDR это не PNG, а обрезанный мусор
  if (!hasAscii(b, 12, "IHDR")) return null;
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  if (width === null || height === null) return null;
  return { mime: "image/png", ext: "png", width, height };
}

/** Маркеры SOFn (начало кадра): C0–CF, кроме C4 (DHT), C8 (JPG) и CC (DAC). */
function isSof(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** JPEG: FF D8 FF, далее обходим сегменты до первого SOFn, где лежат высота и ширина (BE). */
function detectJpeg(b: Uint8Array): FileTypeInfo | null {
  if (!hasBytes(b, 0, [0xff, 0xd8, 0xff])) return null;
  let width: number | null = null;
  let height: number | null = null;
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) break; // повреждённая структура — размеры неизвестны
    while (b[i] === 0xff) i++; // байты-заполнители FF
    const marker = u8(b, i);
    if (marker === null) break;
    i++;
    // маркеры без тела: SOI, TEM, RSTn
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    // EOI или начало скана: SOF уже не встретится
    if (marker === 0xd9 || marker === 0xda) break;
    if (isSof(marker)) {
      height = u16be(b, i + 3);
      width = u16be(b, i + 5);
      break;
    }
    const segLen = u16be(b, i);
    if (segLen === null || segLen < 2) break;
    i += segLen;
  }
  return { mime: "image/jpeg", ext: "jpg", width, height };
}

/** GIF: "GIF87a"/"GIF89a", ширина и высота логического экрана (LE) по смещениям 6/8. */
function detectGif(b: Uint8Array): FileTypeInfo | null {
  if (!hasAscii(b, 0, "GIF87a") && !hasAscii(b, 0, "GIF89a")) return null;
  const width = u16le(b, 6);
  const height = u16le(b, 8);
  if (width === null || height === null) return null;
  return { mime: "image/gif", ext: "gif", width, height };
}

/** WebP: "RIFF....WEBP", размеры зависят от первого чанка: VP8 (lossy), VP8L (lossless), VP8X (extended). */
function detectWebp(b: Uint8Array): FileTypeInfo | null {
  if (!hasAscii(b, 0, "RIFF") || !hasAscii(b, 8, "WEBP")) return null;
  let width: number | null = null;
  let height: number | null = null;
  if (hasAscii(b, 12, "VP8 ")) {
    const w = u16le(b, 26);
    const h = u16le(b, 28);
    if (w !== null && h !== null) {
      width = w & 0x3fff;
      height = h & 0x3fff;
    }
  } else if (hasAscii(b, 12, "VP8L")) {
    const b0 = u8(b, 21);
    const b1 = u8(b, 22);
    const b2 = u8(b, 23);
    const b3 = u8(b, 24);
    if (b0 !== null && b1 !== null && b2 !== null && b3 !== null) {
      width = 1 + (b0 | ((b1 & 0x3f) << 8));
      height = 1 + ((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10));
    }
  } else if (hasAscii(b, 12, "VP8X")) {
    const w = u24le(b, 24);
    const h = u24le(b, 27);
    if (w !== null && h !== null) {
      width = w + 1;
      height = h + 1;
    }
  }
  return { mime: "image/webp", ext: "webp", width, height };
}

/** PDF: "%PDF-"; размеров у документа нет. */
function detectPdf(b: Uint8Array): FileTypeInfo | null {
  if (!hasAscii(b, 0, "%PDF-")) return null;
  return { mime: "application/pdf", ext: "pdf", width: null, height: null };
}

/**
 * Тип файла по магическим байтам: PNG, JPEG, GIF, WebP или PDF, иначе null
 * (в том числе SVG и любой текст — их как загрузки не принимаем).
 */
export function detectFileType(bytes: Uint8Array): FileTypeInfo | null {
  return (
    detectPng(bytes) ??
    detectJpeg(bytes) ??
    detectGif(bytes) ??
    detectWebp(bytes) ??
    detectPdf(bytes) ??
    null
  );
}
