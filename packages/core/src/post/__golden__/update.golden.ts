/// <reference types="node" />
/**
 * Regenerates the golden NC files (T017, D-025): `pnpm --filter @nittcam/core golden:update`.
 * Never run by `pnpm test`; the byte-for-byte test (`golden.test.ts`) never updates anything.
 * A changed golden file needs the owner's approval (PR label `needs-human`).
 */
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TEST_PROGRAM_PREFIX, testProgramCases } from '../../testcut/golden.testing';
import { goldenCases } from '../golden.testing';

const MACHINES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../machines');

describe('golden:update', () => {
  it('writes every post × fixture program', () => {
    const cases = goldenCases();
    for (const c of cases) {
      expect(c.result.errors).toEqual([]);
      const dir = join(MACHINES, c.dir, 'golden');
      mkdirSync(dir, { recursive: true });
      for (const old of readdirSync(dir).filter((f) => f.startsWith(`${c.fixtureId}_`))) {
        rmSync(join(dir, old));
      }
      for (const f of c.result.files) {
        writeFileSync(join(dir, f.name), f.content, 'utf8');
        console.log(`wrote ${c.dir}/golden/${f.name} (${f.content.length} bytes)`);
      }
    }
  });

  it('writes the air-cut and test-cut programs (T022)', () => {
    for (const c of testProgramCases()) {
      expect(c.result.ok).toBe(true);
      const dir = join(MACHINES, c.dir, 'golden');
      mkdirSync(dir, { recursive: true });
      for (const old of readdirSync(dir).filter((f) => f.startsWith(TEST_PROGRAM_PREFIX[c.kind]))) {
        rmSync(join(dir, old));
      }
      for (const f of c.result.files) {
        writeFileSync(join(dir, f.name), f.content, 'utf8');
        console.log(`wrote ${c.dir}/golden/${f.name} (${f.content.length} bytes)`);
      }
    }
  });
});
