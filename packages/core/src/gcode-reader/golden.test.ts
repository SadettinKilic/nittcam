/// <reference types="node" />
/**
 * The reader reads every golden file of the post processor (T017, D-025;
 * `packages/machines/<post>/<version>/golden/`) with zero errors and zero warnings in strict mode
 * (T018, D-026). The files are read as **data**: nothing from `src/post` is imported, so the
 * reader stays independent (§6.5).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readGcode } from './reader';

const MACHINES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../machines');

function goldenFiles(): { name: string; path: string }[] {
  const out: { name: string; path: string }[] = [];
  for (const post of readdirSync(MACHINES, { withFileTypes: true })) {
    if (!post.isDirectory()) continue;
    for (const ver of readdirSync(join(MACHINES, post.name), { withFileTypes: true })) {
      if (!ver.isDirectory()) continue;
      const dir = join(MACHINES, post.name, ver.name, 'golden');
      let names: string[];
      try {
        names = readdirSync(dir);
      } catch {
        continue;
      }
      for (const f of names.filter((n) => /\.(nc|tap)$/i.test(n)).sort()) {
        out.push({ name: `${post.name}/${ver.name}/${f}`, path: join(dir, f) });
      }
    }
  }
  return out;
}

const FILES = goldenFiles();

describe('golden files read cleanly (strict mode)', () => {
  it('finds the six golden files (generic + mach3, 3 each)', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(6);
    expect(FILES.some((f) => f.name.startsWith('generic/'))).toBe(true);
    expect(FILES.some((f) => f.name.startsWith('mach3/'))).toBe(true);
  });

  it.each(FILES)('$name', ({ path }) => {
    const r = readGcode(readFileSync(path, 'utf8'));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.lineEnding).toBe('crlf');
    expect(r.moves.length).toBeGreaterThan(10);
    expect(r.finalState.ended).toBe(true);
    expect(r.finalState.spindle).toBe('off');
    const { units, distance, plane, wcs } = r.finalState.explicit;
    expect([units, distance, plane, wcs]).toEqual([true, true, true, true]);
    // Every feed/arc move has a feed and runs with the spindle on.
    for (const m of r.moves) {
      if (m.type !== 'rapid') {
        expect(m.feed).not.toBeNull();
        expect(m.spindleOn).toBe(true);
      }
    }
  });
});
