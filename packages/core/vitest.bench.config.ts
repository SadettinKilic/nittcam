import { defineConfig } from 'vitest/config';

/**
 * Benchmarks only (`pnpm --filter @nittcam/core bench:nesting` / `bench:order`); not part of
 * `pnpm test`.
 */
export default defineConfig({
  test: {
    include: ['src/nesting/__bench__/*.bench.ts', 'src/toolpath/__bench__/*.bench.ts'],
    silent: false,
    reporters: ['verbose'],
  },
});
