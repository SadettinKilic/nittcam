#!/usr/bin/env node
// D-048 merge gate: did every required CI job pass on the code the PR will merge?
//   node tools/ci/full-run-ok.mjs <pr-number>     exit 0 = CI-wise ok to merge, 1 = not yet
//
// Rules (kept strict; only cheaper):
// - Only manual dispatch runs count (`gh workflow run CI --ref <branch>`), never PR fast checks.
// - Every required job (build, db, all e2e shards, visual · axe) must have a successful latest
//   attempt on the target commit. Jobs may come from different dispatch runs on that same
//   commit (e.g. a full run + a `-f scope=visual -f baselines=update` run, or a re-run of a flaky
//   shard), because they all tested the same commit.
// - Target commit = the PR head, except when the head is a CI baseline commit (author
//   github-actions[bot], "(CI baseline refresh, D-048)", only e2e/visual-baselines/ files, parent =
//   its "Base:" commit, produced by a baseline-update run whose visual job passed on that base):
//   then the target is that base. So a `-f baselines=update` run counts without a second run.
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

export const SHARDS = 5;
export const REQUIRED = [
  { label: 'build', re: /^lint · typecheck/ },
  { label: 'db', re: /^db · / },
  ...Array.from({ length: SHARDS }, (_, i) => ({
    label: `e2e ${i + 1}/${SHARDS}`,
    re: new RegExp(`^e2e · chromium \\(shard ${i + 1}/${SHARDS}\\)$`),
  })),
  { label: 'visual', re: /^visual · axe/ },
];

const BOT = 'github-actions[bot]';

/**
 * commit: { sha, author, message, parents: [sha], files: [path] } (from the GitHub API).
 * Returns { base, runId } when it is a CI baseline commit, else null.
 */
export function baselineCommit(commit) {
  if (!commit || commit.author !== BOT) return null;
  if (!commit.message.includes('(CI baseline refresh, D-048)')) return null;
  if (commit.parents.length !== 1) return null;
  if (!commit.files.length || !commit.files.every((f) => f.startsWith('e2e/visual-baselines/')))
    return null;
  const base = /^Base: ([0-9a-f]{40})$/m.exec(commit.message)?.[1];
  const runId = Number(/\/actions\/runs\/(\d+)/.exec(commit.message)?.[1]);
  if (!base || base !== commit.parents[0] || !runId) return null;
  return { base, runId };
}

/**
 * headSha: PR head. commits: Map sha → commit (only needed for bot commits).
 * runs: dispatch runs [{ databaseId, headSha, status, jobs: [{ name, conclusion }] }].
 */
export function evaluate(headSha, commits, runs) {
  let target = headSha;
  const viaBot = [];
  for (let i = 0; i < 3; i++) {
    const b = baselineCommit(commits.get(target));
    if (!b) break;
    viaBot.push(b);
    target = b.base;
  }
  for (const b of viaBot) {
    const r = runs.find((x) => x.databaseId === b.runId);
    const visualOk = r?.jobs.some((j) => /^visual · axe/.test(j.name) && j.conclusion === 'success');
    if (!r || r.headSha !== b.base || !visualOk)
      return { ok: false, reason: `baseline commit's run ${b.runId} is not a green visual run on its base` };
  }
  const onTarget = runs.filter((r) => r.headSha === target);
  const short = target.slice(0, 7);
  if (!onTarget.length) return { ok: false, target, reason: `no manual CI run on ${short}` };
  const missing = REQUIRED.filter(
    ({ re }) => !onTarget.some((r) => r.jobs.some((j) => re.test(j.name) && j.conclusion === 'success')),
  ).map((m) => m.label);
  if (!missing.length)
    return {
      ok: true,
      target,
      reason: `all required jobs green on ${short}${viaBot.length ? ' (head = CI baseline commit on top)' : ''}`,
    };
  const pending = onTarget.filter((r) => r.status !== 'completed').map((r) => r.databaseId);
  return {
    ok: false,
    target,
    reason: `not green on ${short}: ${missing.join(', ')}${pending.length ? ` (still running: ${pending.join(', ')})` : ''}`,
  };
}

const gh = (args) => JSON.parse(execFileSync('gh', args, { encoding: 'utf8' }));

function fetchCommit(sha) {
  const c = gh(['api', `repos/{owner}/{repo}/commits/${sha}`]);
  return {
    sha,
    author: c.author?.login ?? c.commit.author.name,
    message: c.commit.message,
    parents: c.parents.map((p) => p.sha),
    files: (c.files ?? []).map((f) => f.filename),
  };
}

const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) {
  const pr = process.argv[2];
  if (!pr) {
    console.error('usage: node tools/ci/full-run-ok.mjs <pr-number>');
    process.exit(2);
  }
  const { headRefName, headRefOid } = gh(['pr', 'view', pr, '--json', 'headRefName,headRefOid']);
  const commits = new Map();
  let sha = headRefOid;
  for (let i = 0; i < 3; i++) {
    const c = fetchCommit(sha);
    commits.set(sha, c);
    const b = baselineCommit(c);
    if (!b) break;
    sha = b.base;
  }
  const shas = new Set([...commits.values()].flatMap((c) => [c.sha, ...c.parents]));
  const list = gh([
    'run', 'list', '--workflow', 'CI', '--branch', headRefName, '--event', 'workflow_dispatch',
    '--limit', '30', '--json', 'databaseId,headSha,status,conclusion',
  ]);
  const runs = list
    .filter((r) => shas.has(r.headSha))
    .map((r) => ({ ...r, jobs: gh(['run', 'view', String(r.databaseId), '--json', 'jobs']).jobs }));
  const v = evaluate(headRefOid, commits, runs);
  console.log(
    `PR #${pr} (${headRefName} @ ${headRefOid.slice(0, 7)}): ${v.ok ? 'OK' : 'NOT YET'}, ${v.reason}`,
  );
  process.exit(v.ok ? 0 : 1);
}
