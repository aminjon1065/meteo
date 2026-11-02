/**
 * Минимальная запись архива PMTiles v3 (https://github.com/protomaps/PMTiles/blob/main/spec/v3):
 * заголовок 127 байт, корневой каталог (≤ 16 КБ вместе с заголовком; иначе — листовые каталоги),
 * метаданные JSON и данные тайлов подряд в порядке tileId. Каталоги и метаданные сжаты gzip,
 * тайлы — как есть. Используется build-terrain.mjs и mbtiles-to-pmtiles.mjs: без сторонних бинарников.
 */
import { renameSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

/** Тип тайла в заголовке PMTiles. */
export const TILE_TYPE = { unknown: 0, mvt: 1, png: 2, jpeg: 3, webp: 4, avif: 5 };
/** Сжатие тайлов: 1 — нет (растровые форматы уже сжаты). */
export const COMPRESSION = { unknown: 0, none: 1, gzip: 2 };

function pushVarint(out, value) {
  let n = value;
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80);
    n = Math.floor(n / 0x80);
  }
  out.push(n);
}

/** Каталог: число записей, дельты tileId, runLength, длины, смещения (0 — сразу за предыдущим). */
function serializeDirectory(entries) {
  const out = [];
  pushVarint(out, entries.length);
  let last = 0;
  for (const e of entries) {
    pushVarint(out, e.tileId - last);
    last = e.tileId;
  }
  for (const e of entries) pushVarint(out, e.runLength);
  for (const e of entries) pushVarint(out, e.length);
  entries.forEach((e, i) => {
    const prev = entries[i - 1];
    if (prev && e.offset === prev.offset + prev.length) pushVarint(out, 0);
    else pushVarint(out, e.offset + 1);
  });
  return gzipSync(Buffer.from(out));
}

/** Корневой каталог (вместе с заголовком ≤ 16 КБ) и при необходимости листовые каталоги. */
function buildDirectories(entries) {
  const root = serializeDirectory(entries);
  if (127 + root.length <= 16_384) return { root, leaves: Buffer.alloc(0) };
  for (let leafSize = 4096; ; leafSize *= 2) {
    const rootEntries = [];
    const leafParts = [];
    let offset = 0;
    for (let i = 0; i < entries.length; i += leafSize) {
      const chunk = entries.slice(i, i + leafSize);
      const leaf = serializeDirectory(chunk);
      rootEntries.push({ tileId: chunk[0].tileId, offset, length: leaf.length, runLength: 0 });
      leafParts.push(leaf);
      offset += leaf.length;
    }
    const rootDir = serializeDirectory(rootEntries);
    if (127 + rootDir.length <= 16_384) return { root: rootDir, leaves: Buffer.concat(leafParts) };
  }
}

function header(h) {
  const b = Buffer.alloc(127);
  b.write("PMTiles", 0, "ascii");
  b.writeUInt8(3, 7);
  const u64 = (off, v) => b.writeBigUInt64LE(BigInt(v), off);
  u64(8, h.rootOffset);
  u64(16, h.rootLength);
  u64(24, h.metadataOffset);
  u64(32, h.metadataLength);
  u64(40, h.leafOffset);
  u64(48, h.leafLength);
  u64(56, h.dataOffset);
  u64(64, h.dataLength);
  u64(72, h.addressed);
  u64(80, h.entries);
  u64(88, h.contents);
  b.writeUInt8(1, 96); // clustered: тайлы в порядке tileId
  b.writeUInt8(COMPRESSION.gzip, 97); // каталоги и метаданные
  b.writeUInt8(h.tileCompression, 98);
  b.writeUInt8(h.tileType, 99);
  b.writeUInt8(h.minZoom, 100);
  b.writeUInt8(h.maxZoom, 101);
  const e7 = (v) => Math.round(v * 1e7);
  const [west, south, east, north] = h.bounds;
  b.writeInt32LE(e7(west), 102);
  b.writeInt32LE(e7(south), 106);
  b.writeInt32LE(e7(east), 110);
  b.writeInt32LE(e7(north), 114);
  b.writeUInt8(h.centerZoom, 118);
  b.writeInt32LE(e7((west + east) / 2), 119);
  b.writeInt32LE(e7((south + north) / 2), 123);
  return b;
}

/**
 * Пишет архив атомарно (через `.part`). `tiles` — массив { tileId, data: Buffer }, любой порядок.
 * Возвращает число тайлов и размер файла.
 */
export function writePmtiles(
  path,
  { tiles, tileType, tileCompression = COMPRESSION.none, bounds, metadata = {}, centerZoom },
) {
  const sorted = [...tiles].sort((a, b) => a.tileId - b.tileId);
  const entries = [];
  let offset = 0;
  for (const t of sorted) {
    entries.push({ tileId: t.tileId, offset, length: t.data.length, runLength: 1 });
    offset += t.data.length;
  }
  const zooms = sorted.map((t) => t.z ?? 0);
  const minZoom = metadata.minzoom ?? Math.min(...zooms);
  const maxZoom = metadata.maxzoom ?? Math.max(...zooms);
  const { root, leaves } = buildDirectories(entries);
  const meta = gzipSync(Buffer.from(JSON.stringify(metadata)));
  const rootOffset = 127;
  const metadataOffset = rootOffset + root.length;
  const leafOffset = metadataOffset + meta.length;
  const dataOffset = leafOffset + leaves.length;
  const head = header({
    rootOffset,
    rootLength: root.length,
    metadataOffset,
    metadataLength: meta.length,
    leafOffset,
    leafLength: leaves.length,
    dataOffset,
    dataLength: offset,
    addressed: sorted.length,
    entries: entries.length,
    contents: sorted.length,
    tileCompression,
    tileType,
    minZoom,
    maxZoom,
    bounds,
    centerZoom: centerZoom ?? Math.min(maxZoom, Math.max(minZoom, 6)),
  });
  const tmp = `${path}.part`;
  writeFileSync(tmp, Buffer.concat([head, root, meta, leaves, ...sorted.map((t) => t.data)]));
  renameSync(tmp, path);
  return { tiles: sorted.length, bytes: dataOffset + offset };
}
