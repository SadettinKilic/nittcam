import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { crc32, unzipStore, zipStore } from './zip';

const enc = (s: string) => new TextEncoder().encode(s);

describe('zip writer (T176)', () => {
  it('crc32 matches the reference value', () => {
    expect(crc32(enc('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('stores entries byte for byte, in order, with fixed bytes', () => {
    const entries = [
      { name: 'a-r1-plaka1.nc', bytes: enc('G21\nG90\n') },
      { name: 'OKU.txt', bytes: enc('Plaka 1 → a-r1-plaka1.nc\r\n') },
    ];
    const zip = zipStore(entries);
    expect(zipStore(entries)).toEqual(zip);
    expect([...zip.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(unzipStore(zip)).toEqual(entries);
  });

  it('refuses non-ASCII names', () => {
    expect(() => zipStore([{ name: 'çekmece.nc', bytes: enc('x') }])).toThrow();
  });

  it('property: any files round-trip', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.stringMatching(/^[a-z0-9-]{1,20}\.nc$/), fc.uint8Array()), {
          maxLength: 6,
        }),
        (files) => {
          const entries = files.map(([name, bytes]) => ({ name, bytes }));
          expect(unzipStore(zipStore(entries))).toEqual(entries);
        },
      ),
    );
  });
});
