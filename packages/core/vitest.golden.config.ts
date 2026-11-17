import { defineConfig } from 'vitest/config';

/** Golden file update only (`pnpm --filter @nittcam/core golden:update`); not part of `pnpm test`. */
export default defineConfig({
  test: {
    include: ['src/post/__golden__/update.golden.ts'],
    silent: false,
    reporters: ['verbose'],
  },
});
