// Unit tests for scripts/check-licenses.mjs (D-009). Run: node --test scripts/
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  checkPackage,
  checkReport,
  devOnlyDependencyNames,
  directDependencyNames,
  isStrongCopyleft,
  parseExpression,
} from './check-licenses.mjs';

const ok = (name, license, direct) => assert.equal(checkPackage({ name, license, direct }), null);
const fails = (name, license, direct) =>
  assert.notEqual(checkPackage({ name, license, direct }), null, `${name} ${license} should fail`);

test('parses SPDX expressions with precedence (AND binds tighter than OR)', () => {
  assert.deepEqual(parseExpression('MIT'), { id: 'MIT' });
  assert.deepEqual(parseExpression('(MIT OR Apache-2.0)'), {
    op: 'OR',
    args: [{ id: 'MIT' }, { id: 'Apache-2.0' }],
  });
  assert.deepEqual(parseExpression('MIT OR ISC AND GPL-3.0'), {
    op: 'OR',
    args: [{ id: 'MIT' }, { op: 'AND', args: [{ id: 'ISC' }, { id: 'GPL-3.0' }] }],
  });
  assert.deepEqual(parseExpression('Apache-2.0 WITH LLVM-exception'), { id: 'Apache-2.0' });
  assert.throws(() => parseExpression('(MIT'));
  assert.throws(() => parseExpression(''));
});

test('classifies GPL/AGPL as strong copyleft but not LGPL', () => {
  for (const id of ['GPL-2.0', 'GPL-3.0-only', 'GPL-2.0-or-later', 'AGPL-3.0', 'GPL'])
    assert.ok(isStrongCopyleft(id), id);
  for (const id of ['LGPL-3.0-or-later', 'MIT', 'MPL-2.0']) assert.ok(!isStrongCopyleft(id), id);
});

test('direct dependencies: only the direct allow-list passes', () => {
  for (const id of [
    'MIT',
    'ISC',
    'BSD-2-Clause',
    'BSD-3-Clause',
    'Apache-2.0',
    'BSL-1.0',
    '0BSD',
    'CC0-1.0',
    'Unlicense',
    'BlueOak-1.0.0',
  ])
    ok('pkg', id, true);
  for (const id of [
    'GPL-3.0',
    'AGPL-3.0',
    'LGPL-3.0',
    'MPL-2.0',
    'CC-BY-4.0',
    'Python-2.0',
    'Zlib',
  ])
    fails('pkg', id, true);
});

test('transitive dependencies: extra licences are allowed, GPL/AGPL never', () => {
  ok('lightningcss', 'MPL-2.0', false);
  ok('caniuse-lite', 'CC-BY-4.0', false);
  ok('argparse', 'Python-2.0', false);
  ok('pako', '(MIT AND Zlib)', false);
  fails('some-lib', 'GPL-2.0', false);
  fails('some-lib', 'AGPL-3.0-only', false);
  fails('some-lib', 'LGPL-3.0', false);
  fails('some-lib', 'UNKNOWN', false);
});

test('LGPL-3.0 is allowed only inside @img/sharp-* and only transitively', () => {
  ok('@img/sharp-win32-x64', 'Apache-2.0 AND LGPL-3.0-or-later', false);
  ok('@img/sharp-libvips-linux-x64', 'LGPL-3.0-or-later', false);
  fails('@img/sharp-libvips-linux-x64', 'LGPL-3.0-or-later', true);
  fails('not-sharp', 'Apache-2.0 AND LGPL-3.0-or-later', false);
  fails('@img/sharp-linux-x64', 'Apache-2.0 AND GPL-3.0', false);
});

test('OR picks any allowed branch, AND needs every part', () => {
  ok('dual', '(MIT OR GPL-3.0)', true);
  fails('both', 'MIT AND GPL-3.0', false);
  ok('both', '(MIT AND BSD-3-Clause)', true);
});

test('checkReport flags violations and uses the group key when license is missing', () => {
  const report = {
    MIT: [{ name: 'a', versions: ['1.0.0'], license: 'MIT' }],
    'GPL-3.0': [{ name: 'bad', versions: ['2.0.0'] }],
    'MPL-2.0': [
      { name: 'lightningcss', versions: ['1.0.0'], license: 'MPL-2.0' },
      { name: 'direct-mpl', versions: ['1.0.0'], license: 'MPL-2.0' },
    ],
  };
  const { checked, violations } = checkReport(report, new Set(['a', 'direct-mpl']));
  assert.equal(checked, 4);
  assert.deepEqual(
    violations.map((v) => [v.name, v.license, v.direct]),
    [
      ['bad', 'GPL-3.0', false],
      ['direct-mpl', 'MPL-2.0', true],
    ],
  );
});

test('directDependencyNames reads every workspace package.json and skips workspace: deps', () => {
  const root = mkdtempSync(join(tmpdir(), 'lic-'));
  try {
    const write = (rel, obj) => {
      mkdirSync(join(root, rel), { recursive: true });
      writeFileSync(join(root, rel, 'package.json'), JSON.stringify(obj));
    };
    writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - apps/*\n  - 'e2e'\n");
    write('.', { devDependencies: { eslint: '9.0.0' } });
    write('apps/web', { dependencies: { next: '16.0.0', '@x/core': 'workspace:*' } });
    write('e2e', { devDependencies: { '@playwright/test': '1.0.0' } });
    mkdirSync(join(root, 'apps/empty'), { recursive: true });
    assert.deepEqual([...directDependencyNames(root)].sort(), [
      '@playwright/test',
      'eslint',
      'next',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// --- tester additions (T002, D-009 scenarios) ---

test('D-009 scenarios: direct GPL and LGPL fail', () => {
  fails('direct-gpl', 'GPL-3.0', true);
  fails('direct-gpl-only', 'GPL-2.0-only', true);
  fails('direct-lgpl', 'LGPL-3.0', true);
  fails('direct-lgpl-2', 'LGPL-2.1-or-later', true);
});

test('D-009 scenarios: transitive AGPL fails, transitive MPL-2.0 passes', () => {
  fails('trans-agpl', 'AGPL-3.0-or-later', false);
  ok('trans-mpl', 'MPL-2.0', false);
});

test('D-009 scenarios: @img/sharp-* Apache-2.0 AND LGPL-3.0-or-later passes only transitively', () => {
  ok('@img/sharp-linux-x64', 'Apache-2.0 AND LGPL-3.0-or-later', false);
  ok('@img/sharp-darwin-arm64', 'Apache-2.0 AND LGPL-3.0-or-later', false);
  fails('@img/sharp-linux-x64', 'Apache-2.0 AND LGPL-3.0-or-later', true);
});

test('D-009 scenarios: unknown and unparseable licences fail', () => {
  fails('mystery', 'SEE LICENSE IN LICENSE.md', false);
  fails('mystery', 'Totally-Made-Up-1.0', false);
  fails('mystery', 'UNKNOWN', true);
  fails('mystery', '', false);
  fails('mystery', undefined, false);
});

test('D-009 scenarios: MIT OR GPL-3.0 passes (used under MIT)', () => {
  ok('dual', 'MIT OR GPL-3.0', false);
  ok('dual', 'MIT OR GPL-3.0', true);
  ok('dual', 'GPL-3.0 OR MIT', true);
  fails('dual-bad', 'GPL-2.0 OR AGPL-3.0', false);
});

test('golden guard regex in ci.yml matches golden paths only', () => {
  const yml = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const m = yml.match(/grep -E '([^']+golden[^']*)'/);
  assert.ok(m, 'golden grep pattern found in ci.yml');
  const re = new RegExp(m[1]);
  for (const p of [
    'packages/machines/generic/v1/golden/a.nc',
    'packages/machines/golden/a.nc',
    'packages/machines/a/golden/sub/b.nc',
  ])
    assert.ok(re.test(p), `${p} should match`);
  for (const p of [
    'packages/machines/src/x.ts',
    'packages/machines/golden-notes.md',
    'packages/core/golden/a.nc',
    'docs/golden/a.nc',
    'packages/machines/src/notgolden/a.nc',
  ])
    assert.ok(!re.test(p), `${p} should not match`);
});

// --- D-032: MPL-2.0 only as a direct devDependency (axe-core) ---
test('D-032: direct MPL-2.0 passes only when dev-only', () => {
  assert.equal(
    checkPackage({ name: '@axe-core/playwright', license: 'MPL-2.0', direct: true, devOnly: true }),
    null,
  );
  fails('@axe-core/playwright', 'MPL-2.0', true);
  assert.notEqual(
    checkPackage({ name: 'x', license: 'GPL-3.0', direct: true, devOnly: true }),
    null,
    'GPL stays forbidden for dev-only deps',
  );
  assert.notEqual(
    checkPackage({ name: 'x', license: 'LGPL-3.0', direct: true, devOnly: true }),
    null,
  );
});

test('D-032: devOnlyDependencyNames excludes anything listed in dependencies', () => {
  const root = mkdtempSync(join(tmpdir(), 'lic-'));
  try {
    const write = (rel, obj) => {
      mkdirSync(join(root, rel), { recursive: true });
      writeFileSync(join(root, rel, 'package.json'), JSON.stringify(obj));
    };
    writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - apps/*\n  - 'e2e'\n");
    write('.', { devDependencies: { eslint: '9.0.0', shared: '1.0.0' } });
    write('apps/web', { dependencies: { next: '16.0.0', shared: '1.0.0' } });
    write('e2e', { devDependencies: { 'axe-x': '1.0.0' } });
    assert.deepEqual([...devOnlyDependencyNames(root)].sort(), ['axe-x', 'eslint']);
    const report = {
      'MPL-2.0': [
        { name: 'axe-x', versions: ['1'] },
        { name: 'shared', versions: ['1'] },
      ],
    };
    const { violations } = checkReport(
      report,
      directDependencyNames(root),
      devOnlyDependencyNames(root),
    );
    assert.deepEqual(
      violations.map((v) => v.name),
      ['shared'],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
