/// <reference types="node" />
/**
 * Tester probe of the gcode-reader lint boundary (T018, D-026, spec §6.5). Lives outside the
 * reader folder on purpose (its string literals hold forbidden import paths).
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const FILE = 'packages/core/src/gcode-reader/probe.ts';

async function lintErrors(code: string): Promise<number> {
  const { ESLint } = await import('eslint');
  const eslint = new ESLint({ cwd: ROOT });
  const [res] = await eslint.lintText(code, { filePath: FILE });
  return (res?.messages ?? []).filter((m) => m.ruleId === 'no-restricted-imports').length;
}

describe('gcode-reader lint boundary (tester probe)', { timeout: 60_000 }, () => {
  it.each([
    "import { generateGcode } from '../post/generate';\nexport const x = generateGcode;",
    "import { buildToolpath } from '../toolpath';\nexport const x = buildToolpath;",
    "import type { Move } from '../toolpath/types';\nexport type X = Move;",
    "export * from '../post/generate';",
    "export { generateGcode } from '../post';",
    "import x from '..';\nexport default x;",
    "import x from '../../src/post/generate';\nexport default x;",
    "import x from '@nittcam/core';\nexport default x;",
  ])('rejects %#', async (code) => {
    expect(await lintErrors(code)).toBeGreaterThan(0);
  });

  it('accepts the one allowed outside import', async () => {
    expect(
      await lintErrors("import { EPS } from '../geometry/constants';\nexport const x = EPS;"),
    ).toBe(0);
  });

  // BUG (T018 review): a "./" prefix in front of ".." slips past the regex `^\.\.(/...)?$` and past
  // independence.test.ts (which allows every specifier starting with "./"). Remove `.fails` once fixed.
  it.fails('rejects ./../post/generate (dot-slash bypass)', async () => {
    expect(
      await lintErrors("import x from './../post/generate';\nexport default x;"),
    ).toBeGreaterThan(0);
  });
});
