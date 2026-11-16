import { defineConfig } from 'vitest/config';

/** Placer benchmark only (`pnpm --filter @nittcam/core bench:nesting`); not part of `pnpm test`. */
export default defineConfig({
  test: {
    include: ['src/nesting/__bench__/*.bench.ts'],
    silent: false,
    reporters: ['verbose'],
  },
});
