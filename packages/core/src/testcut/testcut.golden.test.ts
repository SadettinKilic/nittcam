/// <reference types="node" />
/**
 * Golden test programs (T022): air cut and test part × 2 posts, compared byte for byte. Never
 * writes; after an intended change run `pnpm --filter @nittcam/core golden:update` and get the
 * owner's approval (PR label `needs-human`).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TEST_PROGRAM_PREFIX, testProgramCases } from './golden.testing';

const MACHINES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../machines');

describe('golden test programs', () => {
  const cases = testProgramCases();

  it.each(cases.map((c) => [c.dir, c.kind, c] as const))('%s %s', (_dir, _kind, c) => {
    expect(c.result.ok).toBe(true);
    const dir = join(MACHINES, c.dir, 'golden');
    expect(existsSync(dir)).toBe(true);
    const onDisk = readdirSync(dir)
      .filter((f) => f.startsWith(TEST_PROGRAM_PREFIX[c.kind]))
      .sort();
    expect(c.result.files.map((f) => f.name).sort()).toEqual(onDisk);
    for (const f of c.result.files) {
      const want = readFileSync(join(dir, f.name));
      expect(Buffer.from(f.content, 'utf8').equals(want), `${c.dir}/golden/${f.name}`).toBe(true);
    }
  });

  it('deterministic', () => {
    expect(testProgramCases().map((c) => c.result.files)).toEqual(cases.map((c) => c.result.files));
  });
});
