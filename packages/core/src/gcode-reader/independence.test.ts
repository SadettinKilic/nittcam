/// <reference types="node" />
/**
 * The reader's independence from the generator is a safety property (spec §6.5, gcode-safety
 * skill, T018, D-026). Two guards:
 * 1. a static scan of every file in this folder with the TypeScript parser: every module
 *    specifier (static import/export, `import()`, `require()`, `import x = require()`,
 *    `typeof import()`) is **resolved** relative to the file and must stay inside this folder or be
 *    `geometry/constants`; package imports must be on a short list of test tooling. Dynamic forms
 *    are rejected outright;
 * 2. the ESLint rules themselves (`no-restricted-imports` + `no-restricted-syntax`), probed with
 *    `lintText`, so the rules cannot be weakened or removed silently.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../../..');
const FOLDER = 'gcode-reader';

const ALLOWED_OUTSIDE = new Set(['geometry/constants']);
const ALLOWED_PACKAGES = new Set([
  'vitest',
  'fast-check',
  'node:fs',
  'node:path',
  'node:url',
  'eslint',
  'typescript',
]);

interface Found {
  spec: string | null;
  form: 'static' | 'dynamic';
}

/** Every module reference in a source file, found with the TypeScript parser (not a regex). */
function moduleRefs(fileName: string, source: string): Found[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out: Found[] = [];
  const lit = (e: ts.Node | undefined): string | null =>
    e && ts.isStringLiteralLike(e) ? e.text : null;
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) {
      if (n.moduleSpecifier) out.push({ spec: lit(n.moduleSpecifier), form: 'static' });
    } else if (ts.isImportEqualsDeclaration(n)) {
      const ref = n.moduleReference;
      if (ts.isExternalModuleReference(ref))
        out.push({ spec: lit(ref.expression), form: 'dynamic' });
    } else if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        (ts.isIdentifier(callee) && callee.text === 'require') ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === 'require');
      if (isImport || isRequire) out.push({ spec: lit(n.arguments[0]), form: 'dynamic' });
    } else if (ts.isImportTypeNode(n)) {
      const arg = n.argument;
      const spec = ts.isLiteralTypeNode(arg) ? lit(arg.literal) : null;
      out.push({ spec, form: 'dynamic' });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Resolves a specifier from a file in this folder; null when it is a package name. */
function resolveFromFolder(spec: string): string | null {
  const s = spec.replace(/\\/g, '/');
  if (!s.startsWith('.') && !s.startsWith('/') && !/^[A-Za-z]:/.test(s) && !s.startsWith('file:'))
    return null;
  if (!s.startsWith('.')) return '<absolute>';
  return posix.normalize(posix.join(FOLDER, s));
}

function allowed(spec: string): boolean {
  const resolved = resolveFromFolder(spec);
  if (resolved === null) return ALLOWED_PACKAGES.has(spec);
  if (resolved.startsWith(`${FOLDER}/`) && !resolved.slice(FOLDER.length + 1).includes('/')) {
    return true;
  }
  return ALLOWED_OUTSIDE.has(resolved);
}

describe('gcode-reader independence: static scan', () => {
  it('every module reference resolves inside the folder, to geometry/constants or to tooling', () => {
    const files = readdirSync(HERE).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      for (const ref of moduleRefs(f, readFileSync(join(HERE, f), 'utf8'))) {
        expect(ref.form, `${f}: dynamic import/require of "${String(ref.spec)}"`).toBe('static');
        expect(ref.spec !== null && allowed(ref.spec), `${f} imports "${String(ref.spec)}"`).toBe(
          true,
        );
      }
    }
  });

  it.each([
    ['./../post/generate', false],
    ['./x/../../toolpath', false],
    ['..', false],
    ['../index', false],
    ['..\\post\\generate', false],
    ['/abs/post', false],
    ['C:/x/post', false],
    ['@nittcam/core', false],
    ['../geometry/constants', true],
    ['./../geometry/constants', true],
    ['./lexer', true],
    ['./x/../lexer', true],
    ['vitest', true],
  ] as const)('resolver: %s → allowed %s', (spec, ok) => {
    expect(allowed(spec)).toBe(ok);
  });

  it('the parser finds every import form', () => {
    const src = [
      "import a from './a';",
      "export * from './b';",
      "const c = require('./c');",
      "const d = module.require('./d');",
      "const e = import('./e');",
      "import f = require('./f');",
      "type G = typeof import('./g');",
    ].join('\n');
    expect(moduleRefs('x.ts', src)).toEqual([
      { spec: './a', form: 'static' },
      { spec: './b', form: 'static' },
      { spec: './c', form: 'dynamic' },
      { spec: './d', form: 'dynamic' },
      { spec: './e', form: 'dynamic' },
      { spec: './f', form: 'dynamic' },
      { spec: './g', form: 'dynamic' },
    ]);
  });
});

describe('gcode-reader independence: ESLint rules', () => {
  const lint = async (code: string): Promise<string[]> => {
    const eslint = new ESLint({ cwd: ROOT });
    const [res] = await eslint.lintText(code, { filePath: join(HERE, 'probe.ts') });
    return (res?.messages ?? [])
      .filter((m) => m.ruleId === 'no-restricted-imports' || m.ruleId === 'no-restricted-syntax')
      .map((m) => m.ruleId ?? '');
  };

  it.each([
    "import type { Toolpath } from '../toolpath';\nexport type X = Toolpath;",
    "import type { Move } from '../toolpath/types';\nexport type X = Move;",
    "import { generateGcode } from '../post/generate';\nexport const x = generateGcode;",
    "import x from './../post/generate';\nexport default x;",
    "import x from './sub/../../post/generate';\nexport default x;",
    "import x from '../geometry/../post/generate';\nexport default x;",
    "import * as core from '..';\nexport const x = core;",
    "import * as core from './..';\nexport const x = core;",
    "import * as core from '@nittcam/core';\nexport const x = core;",
    "import { offset } from '../geometry/offset';\nexport const x = offset;",
    "export * from './../post';",
    "import { createRequire } from 'node:module';\nexport const x = createRequire;",
    "export const x = require('../post/generate');",
    "export const x = require('./lexer');",
    "export const x = import('./../post/generate');",
    "import x = require('../post/generate');\nexport default x;",
    "export type X = typeof import('../toolpath');",
  ])('rejects %#: %s', async (code) => {
    expect((await lint(code)).length).toBeGreaterThan(0);
  });

  it('accepts the allowed imports', async () => {
    const code = [
      "import { EPS } from '../geometry/constants';",
      "import { lexLine } from './lexer';",
      'export const x = [EPS, lexLine];',
    ].join('\n');
    expect(await lint(code)).toEqual([]);
  });
}, 60_000);
