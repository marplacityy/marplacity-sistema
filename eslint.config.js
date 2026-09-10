import globals from 'globals';

// Se comprueban errores que cambian el comportamiento. El formato histórico se conserva.
export default [
  { ignores: ['node_modules/**', 'dist/**', '.runtime/**', 'playwright-report/**', 'test-results/**'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser, ...globals.node, QRious: 'readonly' } },
    rules: {
      'no-undef': 'error', 'no-dupe-args': 'error', 'no-dupe-keys': 'error',
      'no-unreachable': 'error', 'no-const-assign': 'error', 'no-import-assign': 'error',
      'no-func-assign': 'error', 'constructor-super': 'error', 'valid-typeof': 'error',
    },
  },
];
