#!/usr/bin/env node
// Licence policy check (D-009). Zero dependencies.
//
// Usage:
//   node scripts/check-licenses.mjs              runs `pnpm licenses list --json` itself
//   node scripts/check-licenses.mjs <file.json>  reads a saved `pnpm licenses list --json` output
//
// Rules:
// - Direct dependencies (dependencies/devDependencies of any workspace package.json)
//   must use a licence from DIRECT_ALLOWED.
// - Transitive dependencies may also use TRANSITIVE_EXTRA, and the LGPL-3.0 part of
//   `@img/sharp-*` (dynamically linked, optional).
// - GPL or AGPL anywhere fails the build.
// SPDX `OR` means we may pick any branch; `AND` means every part must be allowed.

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DIRECT_ALLOWED = new Set([
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
]);

export const TRANSITIVE_EXTRA = new Set(['MPL-2.0', 'CC-BY-4.0', 'Python-2.0']);

const SHARP_LGPL = /^LGPL-3\.0(-only|-or-later|\+)?$/;
const SHARP_PACKAGE = /^@img\/sharp-/;

/** True for GPL/AGPL ids (not LGPL). */
export function isStrongCopyleft(id) {
  return /^(A?GPL)-/.test(id) || id === 'GPL' || id === 'AGPL';
}

/** Tokenises an SPDX expression into ids, `AND`, `OR`, `(`, `)`. `WITH x` is dropped. */
function tokenize(expr) {
  const raw = expr.replace(/[()]/g, ' $& ').trim().split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    const up = t.toUpperCase();
    if (up === 'WITH') {
      i++; // skip the exception id; the base licence decides
      continue;
    }
    out.push(up === 'AND' || up === 'OR' ? up : t);
  }
  return out;
}

/** Parses an SPDX expression into a tree: {id} | {op:'AND'|'OR', args:[...]}. */
export function parseExpression(expr) {
  const tokens = tokenize(String(expr ?? ''));
  let pos = 0;
  const peek = () => tokens[pos];
  function primary() {
    const t = tokens[pos++];
    if (t === undefined) throw new Error(`unexpected end of licence expression "${expr}"`);
    if (t === '(') {
      const node = orExpr();
      if (tokens[pos++] !== ')') throw new Error(`missing ")" in licence expression "${expr}"`);
      return node;
    }
    if (t === ')' || t === 'AND' || t === 'OR') {
      throw new Error(`unexpected "${t}" in licence expression "${expr}"`);
    }
    return { id: t };
  }
  function andExpr() {
    const args = [primary()];
    while (peek() === 'AND') {
      pos++;
      args.push(primary());
    }
    return args.length === 1 ? args[0] : { op: 'AND', args };
  }
  function orExpr() {
    const args = [andExpr()];
    while (peek() === 'OR') {
      pos++;
      args.push(andExpr());
    }
    return args.length === 1 ? args[0] : { op: 'OR', args };
  }
  const tree = orExpr();
  if (pos !== tokens.length) throw new Error(`trailing tokens in licence expression "${expr}"`);
  return tree;
}

/** Is a single licence id allowed for this package? */
export function isIdAllowed(id, { name, direct }) {
  if (isStrongCopyleft(id)) return false;
  if (DIRECT_ALLOWED.has(id)) return true;
  if (direct) return false;
  if (TRANSITIVE_EXTRA.has(id)) return true;
  return SHARP_PACKAGE.test(name) && SHARP_LGPL.test(id);
}

function evaluate(node, ctx) {
  if ('id' in node) return isIdAllowed(node.id, ctx);
  if (node.op === 'AND') return node.args.every((a) => evaluate(a, ctx));
  return node.args.some((a) => evaluate(a, ctx));
}

/**
 * Checks one package. Returns null when allowed, otherwise a reason string.
 * @param {{name: string, license: string, direct: boolean}} pkg
 */
export function checkPackage({ name, license, direct }) {
  let tree;
  try {
    tree = parseExpression(license);
  } catch (err) {
    return `unparseable licence: ${err.message}`;
  }
  if (evaluate(tree, { name, direct })) return null;
  return direct
    ? `direct dependency licence "${license}" is not on the direct allow-list`
    : `transitive dependency licence "${license}" is not allowed`;
}

/**
 * Checks the parsed output of `pnpm licenses list --json`.
 * @param {Record<string, Array<{name: string, versions?: string[], license?: string}>>} report
 * @param {Set<string>} directNames
 * @returns {{checked: number, violations: Array<{name: string, versions: string[], license: string, direct: boolean, reason: string}>}}
 */
export function checkReport(report, directNames) {
  const violations = [];
  let checked = 0;
  for (const [group, pkgs] of Object.entries(report)) {
    for (const p of pkgs) {
      checked++;
      const license = p.license || group;
      const direct = directNames.has(p.name);
      const reason = checkPackage({ name: p.name, license, direct });
      if (reason) {
        violations.push({ name: p.name, versions: p.versions ?? [], license, direct, reason });
      }
    }
  }
  return { checked, violations };
}

/** Workspace package.json paths from pnpm-workspace.yaml (simple `dir/*` or `dir` globs). */
export function workspaceManifests(root) {
  const yaml = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8');
  const patterns = [...yaml.matchAll(/^\s*-\s*['"]?([^'"\s#]+)['"]?/gm)].map((m) => m[1]);
  const manifests = [join(root, 'package.json')];
  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const dir = join(root, pattern.slice(0, -2));
      let entries = [];
      try {
        entries = readdirSyncDirs(dir);
      } catch {
        continue;
      }
      for (const e of entries) manifests.push(join(dir, e, 'package.json'));
    } else {
      manifests.push(join(root, pattern, 'package.json'));
    }
  }
  return manifests;
}

function readdirSyncDirs(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

/** Names of all direct, non-workspace dependencies. */
export function directDependencyNames(root) {
  const names = new Set();
  for (const file of workspaceManifests(root)) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      continue; // folder without a package.json
    }
    for (const field of ['dependencies', 'devDependencies']) {
      for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
        if (!String(spec).startsWith('workspace:')) names.add(name);
      }
    }
  }
  return names;
}

function loadReport(file) {
  if (file) return JSON.parse(readFileSync(file, 'utf8'));
  // Fixed command string (no user input); execSync resolves pnpm(.cmd) on every OS.
  const out = execSync('pnpm licenses list --json', {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function main() {
  const root = process.cwd();
  const report = loadReport(process.argv[2]);
  const direct = directDependencyNames(root);
  const { checked, violations } = checkReport(report, direct);
  if (violations.length === 0) {
    console.log(`licence check: OK (${checked} packages, ${direct.size} direct)`);
    return;
  }
  console.error(
    `licence check: ${violations.length} violation(s) (policy: docs/DECISIONS.md D-009)`,
  );
  for (const v of violations) {
    console.error(
      `  ${v.name}@${v.versions.join(',')} [${v.direct ? 'direct' : 'transitive'}]: ${v.reason}`,
    );
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
