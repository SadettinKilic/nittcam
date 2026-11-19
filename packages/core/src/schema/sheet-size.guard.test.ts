import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * T164 / D-056: sheet sizes are read only through `sheetSizeOf` / `defaultSheet` /
 * `stockSheetSizes` (schema/sheet-size.ts). Writers (the plate commands) and the schema itself
 * are the only other places that may touch `stock.sheet`.
 */
const SRC = join(__dirname, '..');
const ALLOWED = new Set(['schema/project.ts', 'schema/sheet-size.ts', 'commands/plate/index.ts']);
const READ = /\bstock\.sheet\b(?!s)/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__fixtures__' ? [] : sources(path);
    if (!/\.tsx?$/.test(name) || /\.(test|testing|bench)\.tsx?$/.test(name)) return [];
    return [path];
  });
}

describe('sheet size guard (T164)', () => {
  it('no direct stock.sheet reads outside the helper', () => {
    const offenders: string[] = [];
    for (const file of sources(SRC)) {
      const rel = relative(SRC, file).split(sep).join('/');
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
