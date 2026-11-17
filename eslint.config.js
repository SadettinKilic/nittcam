// @ts-check
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** packages/core is pure (spec §10.1). */
const CORE_PURE_PATTERNS = [
  {
    group: ['@nittcam/web', '@nittcam/web/*', '**/apps/**'],
    message: 'packages/core must not import from apps/* (spec §10.1).',
  },
  {
    group: ['@nittcam/db', '@nittcam/db/*', '@nittcam/ui', '@nittcam/ui/*'],
    message: 'packages/core is pure: no database or UI code.',
  },
  {
    group: ['react', 'react-dom', 'next', 'next/*'],
    message: 'packages/core is pure: no UI framework code.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      '**/playwright-report/**',
      '**/test-results/**',
      'graphify-out/**',
      'tools/**',
      '.claude/**',
      '.team/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin },
    settings: { next: { rootDir: 'apps/web' } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
    },
  },
  // Dependency direction (spec §10.1, CLAUDE.md): packages/core is pure and never
  // imports from apps/*, db, ui or framework/UI code.
  {
    files: ['packages/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: CORE_PURE_PATTERNS }],
    },
  },
  // G-code reader independence (spec §6.5, gcode-safety skill, T018, D-026): the reader is a
  // second, independent implementation, so it must not import the generator side (post
  // processor, toolpath model) or the core barrel that re-exports them. The only import allowed
  // outside its own folder is the shared tolerance file `geometry/constants`.
  // Flat config replaces rule options per file, so the core patterns are repeated here.
  {
    files: ['packages/core/src/gcode-reader/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...CORE_PURE_PATTERNS,
            {
              regex: '^\\.\\.(/(?!geometry/constants$).*)?$',
              message:
                'gcode-reader must stay independent of the generator (spec §6.5): only ../geometry/constants may be imported from outside the folder.',
            },
            {
              regex: '^@nittcam/',
              message: 'gcode-reader must not import workspace packages (spec §6.5 independence).',
            },
          ],
        },
      ],
    },
  },
);
