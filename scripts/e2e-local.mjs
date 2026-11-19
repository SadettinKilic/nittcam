#!/usr/bin/env node
// D-048: low-memory local e2e for agents. One local e2e at a time on this PC: a lock file in the
// OS temp dir makes a second worktree wait instead of starting a second Next server + Chromium
// (two at once ran the PC out of memory). Defaults to 1 worker. Builds first unless --no-build.
//
//   pnpm e2e:local tests/b11-props.spec.ts            chromium project, 1 worker, given specs
//   pnpm e2e:local --visual pages                      visual project (review captures; no
//                                                      baselines off Linux)
//   pnpm e2e:changed                                   only specs changed vs origin/main
//   pnpm e2e:local --no-build -g "grain"               skip the build (only if nothing changed)
//
// Env: E2E_WORKERS (default 1), E2E_LOCK_WAIT_MIN (default 45), E2E_PORT (playwright config).
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

export const LOCK_PATH = join(tmpdir(), 'nittcam-e2e.lock');

/** True when a process with this pid is running. */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** Reads the lock holder, or null when there is no lock (or it is unreadable). */
export function readLock(path = LOCK_PATH) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Tries once to take the lock. Returns { ok: true } or { ok: false, holder }. A lock whose
 * holder process is gone (crash, killed shell) is stale and taken over.
 */
export function tryLock(path = LOCK_PATH, me = { pid: process.pid, cwd: process.cwd() }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx');
      writeFileSync(fd, JSON.stringify({ ...me, since: new Date().toISOString() }));
      closeSync(fd);
      return { ok: true };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const holder = readLock(path);
      if (holder && pidAlive(holder.pid)) return { ok: false, holder };
      rmSync(path, { force: true }); // stale
    }
  }
  return { ok: false, holder: readLock(path) };
}

/** Removes the lock only when it is ours. */
export function unlock(path = LOCK_PATH, pid = process.pid) {
  const holder = readLock(path);
  if (holder && holder.pid === pid) rmSync(path, { force: true });
}

/** Splits our own flags from the ones passed through to Playwright. */
export function parseArgs(argv) {
  const opts = { build: true, project: 'chromium', pass: [] };
  for (const a of argv) {
    if (a === '--no-build') opts.build = false;
    else if (a === '--visual') opts.project = 'visual';
    else opts.pass.push(a);
  }
  return opts;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function run(cmd, args) {
  const win = process.platform === 'win32';
  // shell: true on Windows (pnpm is a .cmd); quote arguments with spaces (e.g. -g "grain dial").
  const argv = win ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : args;
  const r = spawnSync(cmd, argv, { stdio: 'inherit', shell: win });
  return r.status ?? 1;
}

const isMain = process.argv[1] && import.meta.url.endsWith(basename(process.argv[1]));
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  const waitMin = Number(process.env.E2E_LOCK_WAIT_MIN ?? 45);
  const deadline = Date.now() + waitMin * 60_000;
  let told = false;
  for (;;) {
    const r = tryLock();
    if (r.ok) break;
    if (!told) {
      console.log(
        `e2e-local: another local e2e is running (pid ${r.holder?.pid} in ${r.holder?.cwd}); waiting (max ${waitMin} min)…`,
      );
      told = true;
    }
    if (Date.now() > deadline) {
      console.error('e2e-local: gave up waiting for the e2e lock');
      process.exit(1);
    }
    sleep(10_000);
  }
  const release = () => unlock();
  process.on('exit', release);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

  let code = opts.build ? run('pnpm', ['build']) : 0;
  if (code === 0) {
    const workers = process.env.E2E_WORKERS ?? '1';
    code = run('pnpm', [
      '--filter',
      '@nittcam/e2e',
      'exec',
      'playwright',
      'test',
      `--project=${opts.project}`,
      `--workers=${workers}`,
      ...opts.pass,
    ]);
  }
  process.exit(code);
}
