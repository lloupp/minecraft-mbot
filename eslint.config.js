'use strict'

const js = require('@eslint/js')
const globals = require('globals')

module.exports = [
  { ignores: ['node_modules/', 'docs/', 'coverage/'] },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: false }],
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      // O padrão `let x = null; try { x = f() } catch { x = null }` é intencional aqui.
      'no-useless-assignment': 'off'
    }
  },
  {
    files: ['lib/dashboard/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } }
  }
]
