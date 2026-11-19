import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T164 / D-056: sheet sizes are read only through `sheetSizeOf` / `defaultSheet` /
 * `stockSheetSizes` (schema/sheet-size.ts), in core and in the web app. Writers (the plate
 * commands) and the schema itself are the only other places that may touch `stock.sheet`.
 */
const REPO = join(__dirname, '..', '..', '..', '..');
const ROOTS = ['packages/core/src', 'apps/web/components', 'apps/web/lib', 'apps/web/app'];
const ALLOWED = new Set([
  'packages/core/src/schema/project.ts',
  'packages/core/src/schema/sheet-size.ts',
  'packages/core/src/commands/plate/index.ts',
]);
const SKIP_DIRS = new Set(['__fixtures__', 'node_modules', '.next']);
const READ = /\bstock\.sheet\b(?!s)/;

function sources(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return SKIP_DIRS.has(name) ? [] : sources(path);
    if (!/\.tsx?$/.test(name) || /\.(test|testing|bench)\.tsx?$/.test(name)) return [];
    return [path];
  });
}

describe('sheet size guard (T164)', () => {
  it('no direct stock.sheet reads outside the helper (core and web)', () => {
    const files = ROOTS.flatMap((root) => sources(join(REPO, root)));
    expect(files.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(REPO, file).split(sep).join('/');
      if (ALLOWED.has(rel)) continue;
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          // the validation issue path string 'stock.sheet' is a label, not a read
          if (READ.test(line) && !/['"`]stock\.sheet['"`]/.test(line)) {
            offenders.push(`${rel}:${i + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });
});
