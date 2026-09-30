import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import { defineConfig } from 'eslint/config'

export default defineConfig(
  { ignores: ['out/', 'dist/', 'release/', 'node_modules/', 'build/'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    },
    languageOptions: { globals: globals.browser }
  },
  {
    files: ['src/main/**', 'src/preload/**', 'tests/**', 'scripts/**', 'hooks/**', '*.config.*'],
    languageOptions: { globals: globals.node }
  },
  {
    files: ['hooks/**/*.js', 'scripts/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  }
)
