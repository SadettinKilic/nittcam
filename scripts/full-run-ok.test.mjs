import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { baselineCommit, evaluate } from '../tools/ci/full-run-ok.mjs';

const ok = (name) => ({ name, conclusion: 'success' });
const SHARDS = [1, 2, 3, 4, 5].map((i) => ok(`e2e · chromium (shard ${i}/5)`));
const FULL = [
  ok('lint · typecheck · test · build · licences'),
  ok('db · migrations + tests on Postgres 17'),
  ...SHARDS,
  ok('visual · axe'),
];
const run = (id, headSha, jobs, status = 'completed') => ({
  databaseId: id,
  headSha,
  status,
  jobs,
});
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const none = new Map();
const bot = (over = {}) => ({
  sha: B,
  author: 'github-actions[bot]',
  message: `test(visual): update Linux baselines (CI baseline refresh, D-048)\n\nRun: https://github.com/o/r/actions/runs/7\n\nBase: ${A}`,
  parents: [A],
  files: ['e2e/visual-baselines/t1-desktop-light.png'],
  ...over,
});

test('all required jobs green on the head commit: ok', () => {
  assert.equal(evaluate(A, none, [run(1, A, FULL)]).ok, true);
});

test('a run on an older commit does not count', () => {
  assert.equal(evaluate(B, none, [run(1, A, FULL)]).ok, false);
});

test('a missing shard or a red job fails; jobs may come from two runs on the same commit', () => {
  const noShard5 = FULL.filter((j) => !j.name.includes('5/5'));
  assert.match(evaluate(A, none, [run(1, A, noShard5)]).reason, /e2e 5\/5/);
  const redVisual = FULL.map((j) =>
    j.name === 'visual · axe' ? { ...j, conclusion: 'failure' } : j,
  );
  assert.equal(evaluate(A, none, [run(1, A, redVisual)]).ok, false);
  const visualRerun = run(2, A, [ok('visual · axe (baseline update)')]);
  assert.equal(evaluate(A, none, [visualRerun, run(1, A, redVisual)]).ok, true);
});

test('a visual-only run never counts on its own', () => {
  assert.equal(evaluate(A, none, [run(1, A, [ok('visual · axe (baseline update)')])]).ok, false);
});

test('head = CI baseline commit of a green update run on its base: ok without a second run', () => {
  const commits = new Map([[B, bot()]]);
  const v = evaluate(B, commits, [
    run(
      7,
      A,
      FULL.map((j) => (j.name === 'visual · axe' ? ok('visual · axe (baseline update)') : j)),
    ),
  ]);
  assert.equal(v.ok, true);
  assert.equal(v.target, A);
});

test('a bot commit that touches anything else, or a human commit, is not skipped', () => {
  assert.equal(
    baselineCommit(bot({ files: ['e2e/visual-baselines/x.png', 'apps/web/a.ts'] })),
    null,
  );
  assert.equal(baselineCommit(bot({ author: 'someone' })), null);
  assert.equal(baselineCommit(bot({ parents: [B] })), null);
  const commits = new Map([[B, bot({ author: 'someone' })]]);
  assert.equal(evaluate(B, commits, [run(7, A, FULL)]).ok, false);
});

test('a bot commit whose run is not a green visual run on its base is rejected', () => {
  const commits = new Map([[B, bot()]]);
  const red = FULL.map((j) => (j.name === 'visual · axe' ? { ...j, conclusion: 'failure' } : j));
  assert.equal(evaluate(B, commits, [run(7, A, red)]).ok, false);
});
