/// <reference types="node" />
/**
 * The reader's independence from the generator is a safety property (spec §6.5, gcode-safety
 * skill, T018, D-026). Two guards: a static scan of every import in this folder, and the ESLint
 * `no-restricted-imports` rule itself (so the rule cannot be removed silently).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');

const ALLOWED_OUTSIDE = new Set(['../geometry/constants']);
const ALLOWED_PACKAGES = new Set([
  'vitest',
  'fast-check',
  'node:fs',
  'node:path',
  'node:url',
  'eslint',
]);

function specifiers(source: string): string[] {
  const out: string[] = [];
  const re =
    /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of source.matchAll(re)) out.push(m[1] ?? m[2] ?? '');
  return out;
}

describe('gcode-reader independence', () => {
  it('imports only its own files, ../geometry/constants and test tooling', () => {
    // This file is skipped: its ESLint probe holds forbidden imports as string literals.
    const files = readdirSync(HERE).filter(
      (f) => f.endsWith('.ts') && f !== 'independence.test.ts',
    );
    expect(files.length).toBeGreaterThan(4);
    for (const f of files) {
      for (const s of specifiers(readFileSync(join(HERE, f), 'utf8'))) {
        const ok = s.startsWith('./') || ALLOWED_OUTSIDE.has(s) || ALLOWED_PACKAGES.has(s);
        expect(ok, `${f} imports "${s}"`).toBe(true);
      }
    }
  });

  it('ESLint rejects imports of the toolpath model, the post processor and the core barrel', async () => {
    const { ESLint } = await import('eslint');
    const eslint = new ESLint({ cwd: ROOT });
    const probe = [
      "import type { Toolpath } from '../toolpath';",
      "import type { Move } from '../toolpath/types';",
      "import { generateGcode } from '../post/generate';",
      "import * as core from '..';",
      "import * as core2 from '@nittcam/core';",
      "import { offset } from '../geometry/offset';",
      "import { EPS } from '../geometry/constants';",
      "import { lexLine } from './lexer';",
      'export type X = [Toolpath, Move, typeof generateGcode, typeof core, typeof core2, typeof offset, typeof EPS, typeof lexLine];',
    ].join('\n');
    const [res] = await eslint.lintText(probe, { filePath: join(HERE, 'probe.ts') });
    const restricted = (res?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports');
    expect(restricted.map((m) => m.line).sort()).toEqual([1, 2, 3, 4, 5, 6]);
  }, 60_000);
});
