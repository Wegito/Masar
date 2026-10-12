import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Gemeinsame ESLint-Basis für alle Workspaces.
 *
 * TypeScript-Dateien werden typbewusst geprüft (z. B. vergessene `await`).
 * JavaScript-Dateien (Konfigurationen) nur mit den Basisregeln.
 *
 * @param {{ tsconfigRootDir: string }} options Verzeichnis der tsconfig.json des Workspaces
 */
export function base({ tsconfigRootDir }) {
  return defineConfig(
    globalIgnores([
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/generated/**',
    ]),
    js.configs.recommended,
    tseslint.configs.recommendedTypeChecked,
    {
      languageOptions: {
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        eqeqeq: ['error', 'smart'],
        // Ausgaben laufen über den Logger, damit Redaction greift.
        'no-console': 'error',
        '@typescript-eslint/consistent-type-imports': [
          'error',
          { fixStyle: 'inline-type-imports' },
        ],
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        // Zustandsautomaten: jeder Status muss behandelt werden.
        '@typescript-eslint/switch-exhaustiveness-check': 'error',
      },
    },
    {
      files: ['**/*.{js,mjs,cjs}'],
      extends: [tseslint.configs.disableTypeChecked],
      languageOptions: { globals: globals.node },
    },
    prettier,
  );
}
