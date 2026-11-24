import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores(['**/node_modules/', '**/dist/', 'coverage/', 'data/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    // core is pure and deterministic: no real clock, no real randomness.
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message: 'core must be deterministic: take the time from the sim clock, not Date.now().',
        },
        {
          object: 'Math',
          property: 'random',
          message: 'core must be deterministic: use the seeded rand(seed, key), not Math.random().',
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'core must be deterministic: new Date() reads the real clock. Pass an explicit time.',
        },
      ],
    },
  },
);
