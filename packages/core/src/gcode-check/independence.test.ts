/// <reference types="node" />
/**
 * The checks must not use the post processor (spec §6.5, D-027): they judge its output. Two guards:
 * 1. every non-test file of this folder is followed **transitively** through its relative imports
 *    (resolved to files, with the TypeScript parser), and no reached file may be under `src/post/`
 *    or be the core barrel (`src/index.ts`);
 * 2. the ESLint rule is probed with `lintText`, so it cannot be weakened silently.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');
const ROOT = resolve(HERE, '../../../..');

function specifiers(file: string): string[] {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier) {
      if (ts.isStringLiteralLike(n.moduleSpecifier)) out.push(n.moduleSpecifier.text);
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      out.push('<dynamic import>');
    } else if (ts.isImportTypeNode(n)) {
      out.push('<import type>');
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function resolveFile(from: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const c of [`${base}.ts`, join(base, 'index.ts'), base]) {
    if (existsSync(c) && c.endsWith('.ts')) return c;
  }
  return null;
}

describe('gcode-check independence from the post processor', () => {
  it('no file reachable from the checks lies in src/post or is the core barrel', () => {
    const roots = readdirSync(HERE)
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.testing.ts'))
      .map((f) => join(HERE, f));
    const seen = new Set<string>();
    const stack = [...roots];
    const bad: string[] = [];
    while (stack.length > 0) {
      const f = stack.pop() as string;
      if (seen.has(f)) continue;
      seen.add(f);
      const rel = relative(SRC, f).replace(/\\/g, '/');
      if (rel.startsWith('post/') || rel === 'index.ts') bad.push(rel);
      for (const s of specifiers(f)) {
        if (s.startsWith('<')) bad.push(`${rel}: ${s}`);
        const r = resolveFile(f, s);
        if (r) stack.push(r);
      }
    }
    expect(bad).toEqual([]);
    // the walk really covered the reader and the toolpath model
    const reached = [...seen].map((f) => relative(SRC, f).replace(/\\/g, '/'));
    expect(reached.some((f) => f.startsWith('gcode-reader/'))).toBe(true);
    expect(reached.some((f) => f.startsWith('toolpath/'))).toBe(true);
  });

  it('the lint rule rejects post and barrel imports from check code, not from tests', async () => {
    const eslint = new ESLint({ cwd: ROOT });
    const file = join(HERE, 'probe.ts');
    const lint = async (code: string, path = file) =>
      (await eslint.lintText(code, { filePath: path }))[0]?.messages.map((m) => m.ruleId) ?? [];
    for (const spec of [
      '../post',
      '../post/frame',
      './../post/generate',
      '..',
      '../index',
      '@nittcam/core',
    ]) {
      expect(await lint(`import { x } from '${spec}';\nexport const y = x;\n`), spec).toContain(
        'no-restricted-imports',
      );
    }
    expect(await lint(`export const m = import('../post');\n`)).toContain('no-restricted-syntax');
    expect(
      await lint(`import { readGcode } from '../gcode-reader';\nexport const r = readGcode;\n`),
    ).toEqual([]);
    expect(
      await lint(
        `import { generateGcode } from '../post';\nexport const g = generateGcode;\n`,
        join(HERE, 'probe.test.ts'),
      ),
    ).toEqual([]);
  }, 60_000);
});
