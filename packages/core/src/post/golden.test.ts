/// <reference types="node" />
/**
 * Golden NC files (T017, D-025): 3 fixtures × 2 posts through the full pipeline, compared byte
 * for byte with `packages/machines/<post>/v1/golden/`. This test never writes anything; after an
 * intended change run `pnpm --filter @nittcam/core golden:update` and get the owner's approval
 * (PR label `needs-human`).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { goldenCases } from './golden.testing';

const MACHINES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../machines');

describe('golden files', () => {
  const cases = goldenCases();

  it.each(cases.map((c) => [c.dir, c.fixtureId, c] as const))('%s %s', (_dir, _fx, c) => {
    expect(c.result.errors).toEqual([]);
    expect(c.result.ok).toBe(true);
    const dir = join(MACHINES, c.dir, 'golden');
    expect(existsSync(dir)).toBe(true);
    const onDisk = readdirSync(dir)
      .filter((f) => f.startsWith(`${c.fixtureId}_`))
      .sort();
    expect(c.result.files.map((f) => f.name).sort()).toEqual(onDisk);
    for (const f of c.result.files) {
      const want = readFileSync(join(dir, f.name));
      const got = Buffer.from(f.content, 'utf8');
      expect(got.equals(want), `${c.dir}/golden/${f.name} differs`).toBe(true);
    }
  });

  it('the pipeline is deterministic', () => {
    const again = goldenCases();
    expect(again.map((c) => c.result.files)).toEqual(cases.map((c) => c.result.files));
  });

  it('golden files keep CRLF line endings (no git conversion)', () => {
    for (const c of cases) {
      for (const f of c.result.files) {
        const raw = readFileSync(join(MACHINES, c.dir, 'golden', f.name), 'latin1');
        expect(raw.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
      }
    }
  });
});
