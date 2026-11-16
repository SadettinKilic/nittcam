// @ts-check
import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

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
      'no-restricted-imports': [
        'error',
        {
          patterns: [
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
          ],
        },
      ],
    },
  },
);
