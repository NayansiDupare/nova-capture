import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import { importX } from 'eslint-plugin-import-x';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import { configs as tseslintConfigs } from 'typescript-eslint';

const TS_PROJECTS = [
  './tsconfig.json',
  './packages/core/tsconfig.test.json',
  './apps/desktop/tsconfig.node.json',
  './apps/desktop/tsconfig.web.json',
];

const NO_ELECTRON = {
  name: 'electron',
  message: 'Electron is only available in apps/desktop/src/main and preload.',
};

export default defineConfig(
  { ignores: ['**/node_modules/**', '**/out/**', '**/dist/**', '**/coverage/**', 'spikes/**'] },

  js.configs.recommended,
  tseslintConfigs.strictTypeChecked,
  importX.flatConfigs.recommended,
  importX.flatConfigs.typescript,

  {
    languageOptions: {
      parserOptions: { project: TS_PROJECTS, tsconfigRootDir: import.meta.dirname },
    },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({ project: TS_PROJECTS, noWarnOnMultipleProjects: true }),
      ],
    },
    rules: {
      'no-console': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'import-x/no-default-export': 'error',
      'import-x/order': [
        'error',
        {
          groups: ['builtin', 'external', 'internal', ['parent', 'sibling', 'index']],
          pathGroups: [{ pattern: '@nova/**', group: 'internal' }],
          pathGroupsExcludedImportTypes: ['builtin'],
          'newlines-between': 'always',
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],
      // AGENTS.md §4: import boundaries.
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './packages/core',
              from: './apps',
              message: 'packages/core must stay pure (AGENTS.md §4.1).',
            },
            {
              target: './apps/desktop/src/renderer',
              from: ['./apps/desktop/src/main', './apps/desktop/src/worker'],
              message: 'Renderers talk to main over IPC only (AGENTS.md §4.2).',
            },
            {
              target: './',
              from: './spikes',
              message: 'Spikes are throwaway code. Never import from them (AGENTS.md §4.11).',
            },
          ],
        },
      ],
    },
  },

  // packages/core: no Node built-ins, no Electron.
  {
    files: ['packages/core/src/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: {
      'import-x/no-nodejs-modules': 'error',
      'no-restricted-imports': ['error', { paths: [NO_ELECTRON] }],
    },
  },

  // Renderers: browser only, plus React rules.
  {
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    extends: [react.configs.flat.recommended, react.configs.flat['jsx-runtime']],
    plugins: { 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      'import-x/no-nodejs-modules': 'error',
      'no-restricted-imports': ['error', { paths: [NO_ELECTRON] }],
    },
  },

  // Tests may use non-null assertions (CODE_STYLE.md §3).
  {
    files: ['**/*.test.{ts,tsx}'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },

  // Tool config files must default-export.
  {
    files: ['**/*.config.{ts,mjs}', 'eslint.config.mjs'],
    rules: { 'import-x/no-default-export': 'off' },
  },

  // Plain JS (this file) is not part of a TS project.
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslintConfigs.disableTypeChecked],
  },

  prettier,
);
