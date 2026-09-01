import { core, reactDoctor, typed } from 'oxspark';
import { defineConfig } from 'oxlint';

export default defineConfig({
  extends: [core, typed, reactDoctor],
  rules: {
    'quality/forbid-process-env-outside-boundaries': [
      'error',
      { allowedFiles: ['vite.config.ts'] },
    ],
  },
  ignorePatterns: [
    '.runtime/**',
    '.wrangler/**',
    'dist/**',
    'node_modules/**',
    'playwright-report/**',
    'test-results/**',
    'vendor-references/**',
  ],
  overrides: [
    {
      files: ['src/server.ts'],
      rules: {
        // The Worker boundary records unexpected errors before returning its public 500 response.
        'eslint/no-console': 'off',
      },
    },
  ],
});
