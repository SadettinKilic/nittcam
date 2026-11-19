import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseArgs, pidAlive, readLock, tryLock, unlock } from './e2e-local.mjs';

const lockIn = () => join(mkdtempSync(join(tmpdir(), 'e2e-lock-')), 'e2e.lock');

test('parseArgs keeps own flags apart from Playwright args', () => {
  assert.deepEqual(parseArgs(['--no-build', '--visual', 'pages', '-g', 'x']), {
    build: false,
    project: 'visual',
    pass: ['pages', '-g', 'x'],
  });
  assert.deepEqual(parseArgs([]), { build: true, project: 'chromium', pass: [] });
});

test('pidAlive: this process yes, a nonsense pid no', () => {
  assert.equal(pidAlive(process.pid), true);
  assert.equal(pidAlive(-1), false);
  assert.equal(pidAlive(2 ** 30), false);
});

test('a live holder blocks the lock; unlock by the holder frees it', () => {
  const path = lockIn();
  assert.equal(tryLock(path, { pid: process.pid, cwd: 'a' }).ok, true);
  const second = tryLock(path, { pid: process.pid + 1, cwd: 'b' });
  assert.equal(second.ok, false);
  assert.equal(second.holder.cwd, 'a');
  unlock(path, process.pid + 1); // not ours: stays
  assert.equal(existsSync(path), true);
  unlock(path, process.pid);
  assert.equal(existsSync(path), false);
});

test('a stale lock (holder gone) is taken over', () => {
  const path = lockIn();
  writeFileSync(path, JSON.stringify({ pid: 2 ** 30, cwd: 'dead' }));
  assert.equal(tryLock(path, { pid: process.pid, cwd: 'me' }).ok, true);
  assert.equal(readLock(path).cwd, 'me');
});
