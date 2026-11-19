/**
 * Vitest setup for every property test in `packages/core` (T273).
 *
 * - Reproducible: `FC_SEED=<n>` (and optionally `FC_PATH=<path>`) replays a failing run; the seed
 *   and path are always in the failure message (fast-check's default report).
 * - Clock-free: no `interruptAfterTimeLimit` / `skipAllAfterTimeLimit`, so a slow CI runner can
 *   never turn a property into a pass or a failure. Long properties raise the Vitest test timeout
 *   instead (the timeout only guards against hangs).
 * - `NITTCAM_RUNS` still sets the run count of the files that read it.
 */
import fc from 'fast-check';

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const num = (s: string | undefined): number | undefined =>
  s !== undefined && s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : undefined;

const seed = num(env?.FC_SEED);

fc.configureGlobal({
  ...fc.readConfigureGlobal(),
  // default report: a failure always prints its seed, path and counter-example (CI logs keep it)
  verbose: 0,
  ...(seed !== undefined ? { seed } : {}),
  ...(env?.FC_PATH ? { path: env.FC_PATH } : {}),
});
