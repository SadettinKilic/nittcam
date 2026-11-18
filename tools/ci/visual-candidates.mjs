#!/usr/bin/env node
// T199a: in CI a missing or changed visual baseline fails the run (Playwright updateSnapshots
// 'none'). Playwright then leaves `<name>-actual.png` under e2e/test-results/. This script copies
// each of them to `e2e/visual-baselines/<name>.png` in the CI workspace only, so the uploaded
// `visual-screenshots` artefact holds the candidate baselines the tester reviews and commits.
// Nothing is committed by CI. Usage: node tools/ci/visual-candidates.mjs [resultsDir] [baselineDir]
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

/** All files under `dir` whose name ends with `-actual.png` (retries: the newest wins). */
export function findActuals(dir) {
  const out = new Map();
  if (!existsSync(dir)) return [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (name.endsWith('-actual.png')) {
        const target = `${basename(name, '-actual.png')}.png`;
        const prev = out.get(target);
        if (!prev || prev.mtime < st.mtimeMs) out.set(target, { path: p, mtime: st.mtimeMs });
      }
    }
  };
  walk(dir);
  return [...out.entries()].map(([target, v]) => ({ target, source: v.path }));
}

const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) {
  const results = process.argv[2] ?? 'e2e/test-results';
  const baselines = process.argv[3] ?? 'e2e/visual-baselines';
  const found = findActuals(results);
  mkdirSync(baselines, { recursive: true });
  for (const { target, source } of found) copyFileSync(source, join(baselines, target));
  console.log(
    found.length
      ? `visual candidates: ${found.length} → ${baselines}/ (${found.map((f) => f.target).join(', ')})`
      : 'visual candidates: none (every capture matched its baseline)',
  );
}
