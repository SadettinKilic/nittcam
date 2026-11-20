import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRateLimit } from '../client-log';
import { REPO_ROOT } from './company';

/** Rotate the client log above this size (one previous file kept as `.1`). */
export const MAX_LOG_BYTES = 1024 * 1024;

/**
 * Where browser error reports go (T187, spec §8.2): a local server file, `LOG_DIR` or
 * `<repo>/.data/logs`. Never sent anywhere else.
 */
export function clientLogPath(): string {
  return join(process.env.LOG_DIR ?? join(REPO_ROOT, '.data', 'logs'), 'client-errors.log');
}

const cache = globalThis as typeof globalThis & {
  nittcamClientLogLimit?: (now: number) => boolean;
};
/** 120 lines a minute per server process. */
export function allowClientLog(now: number): boolean {
  cache.nittcamClientLogLimit ??= createRateLimit(120, 60_000);
  return cache.nittcamClientLogLimit(now);
}

/** Appends one line; rotates the file first when it is full. */
export async function appendClientLog(line: string, path = clientLogPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const size = await stat(path).then(
    (s) => s.size,
    () => 0,
  );
  if (size + line.length > MAX_LOG_BYTES && size > 0) await rename(path, `${path}.1`);
  await appendFile(path, line, 'utf8');
}
