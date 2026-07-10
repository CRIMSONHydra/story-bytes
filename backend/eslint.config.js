import eslintConfigPrettier from 'eslint-config-prettier';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**']
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: false,
        sourceType: 'module'
      }
    },
    rules: {
      // Use the pino logger (services/logger.ts), never console, in application code.
      'no-console': 'error',
      // Allow intentionally-unused args/vars prefixed with `_` (e.g. Express's 4-arg error handler
      // needs a trailing `next` even when unused).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
    }
  },
  {
    // Standalone dev/diagnostic CLIs are meant to print to the terminal.
    files: ['src/scripts/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'off'
    }
  },
  eslintConfigPrettier
);

