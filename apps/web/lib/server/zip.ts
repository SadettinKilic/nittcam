/**
 * A minimal ZIP writer (T176): stored entries (no compression), ASCII names, a fixed timestamp, so
 * the same files always give the same bytes. Enough for a handful of NC / DXF / PDF files; no
 * dependency (APPNOTE 6.3, local headers + central directory, no ZIP64).
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** DOS date 1980-01-01 00:00 (the earliest a ZIP can hold): the bytes never depend on the clock. */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

export interface ZipEntry {
  /** ASCII file name (D-025), no folders. */
  name: string;
  bytes: Uint8Array;
}

/** The ZIP archive of the entries, in the given order. */
export function zipStore(entries: readonly ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    if (!/^[\x20-\x7e]+$/.test(e.name)) throw new Error(`zip entry name must be ASCII: ${e.name}`);
    const name = enc.encode(e.name);
    const crc = crc32(e.bytes);
    const size = e.bytes.byteLength;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0, true); // flags
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // made by
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, e.bytes);
    centrals.push(central);
    offset += local.length + size;
  }
  const dirSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, dirSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + dirSize + end.length);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Reads a stored-only archive back (tests and checks): name → bytes, in order. */
export function unzipStore(zip: Uint8Array): ZipEntry[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const out: ZipEntry[] = [];
  let at = 0;
  const dec = new TextDecoder();
  while (at + 4 <= zip.length && v.getUint32(at, true) === 0x04034b50) {
    const size = v.getUint32(at + 18, true);
    const nameLen = v.getUint16(at + 26, true);
    const extra = v.getUint16(at + 28, true);
    const start = at + 30 + nameLen + extra;
    out.push({
      name: dec.decode(zip.subarray(at + 30, at + 30 + nameLen)),
      bytes: zip.slice(start, start + size),
    });
    at = start + size;
  }
  return out;
}
