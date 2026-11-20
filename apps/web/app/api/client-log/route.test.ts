/**
 * T187: POST /api/client-log writes one JSON line to the local client log (LOG_DIR); bad,
 * oversized and rate-limited reports are refused.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { appendClientLog, clientLogPath } from '../../../lib/server/client-log';
import { POST } from './route';

const dir = mkdtempSync(join(tmpdir(), 'nittcam-client-log-'));
process.env.LOG_DIR = dir;

const post = (body: string) =>
  POST(
    new Request('http://test/api/client-log', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'vitest' },
      body,
    }),
  );

afterAll(() => {
  delete process.env.LOG_DIR;
  rmSync(dir, { recursive: true, force: true });
});

describe('POST /api/client-log (T187)', () => {
  it('appends a report as one line', async () => {
    const res = await post(JSON.stringify({ kind: 'error', message: 'Boom', url: '/projeler' }));
    expect(res.status).toBe(204);
    const lines = readFileSync(clientLogPath(), 'utf8').trim().split('\n');
    const last = JSON.parse(lines.at(-1) ?? '{}') as Record<string, string>;
    expect(last).toMatchObject({ kind: 'error', message: 'Boom', url: '/projeler', ua: 'vitest' });
    expect(last['at']).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('refuses bad JSON, bad reports and big bodies', async () => {
    expect((await post('{nope')).status).toBe(400);
    expect((await post(JSON.stringify({ kind: 'x', message: 'm' }))).status).toBe(400);
    const big = JSON.stringify({ kind: 'error', message: 'm', stack: 'x'.repeat(20_000) });
    expect((await post(big)).status).toBe(413);
  });

  it('rate limit: 120 lines a minute, then 429 and nothing more is written (tester, T187)', async () => {
    const before = readFileSync(clientLogPath(), 'utf8').split('\n').length;
    const statuses: number[] = [];
    for (let i = 0; i < 130; i += 1) {
      statuses.push((await post(JSON.stringify({ kind: 'error', message: `flood ${i}` }))).status);
    }
    expect(statuses).toContain(429);
    expect(statuses.filter((s) => s === 204).length).toBeLessThanOrEqual(120);
    expect(statuses.slice(statuses.indexOf(429)).every((s) => s === 429)).toBe(true);
    const after = readFileSync(clientLogPath(), 'utf8').split('\n').length;
    expect(after - before).toBe(statuses.filter((s) => s === 204).length);
  });

  it('server side never sends reports anywhere else (tester, T187)', () => {
    const src = ['./route.ts', '../../../lib/server/client-log.ts', '../../../lib/client-log.ts']
      .map((p) => readFileSync(new URL(p, import.meta.url), 'utf8'))
      .join('\n');
    expect(src).not.toMatch(/\bfetch\(|https?:\/\/|node:https?|node:net|sendBeacon/);
  });

  it('rotates a full log file', async () => {
    const path = join(dir, 'rot.log');
    writeFileSync(path, 'x'.repeat(1024 * 1024));
    await appendClientLog('new\n', path);
    expect(readFileSync(path, 'utf8')).toBe('new\n');
    expect(readFileSync(`${path}.1`, 'utf8')).toHaveLength(1024 * 1024);
  });
});
