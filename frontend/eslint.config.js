// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

const MESSAGE_SERVICE_BAN = {
  name: 'primeng/api',
  importNames: ['MessageService'],
  message:
    "One toast API: use NotificationService (core/notify) for toasts and UndoService for Undo. PrimeNG's MessageService has no toast host (S16, #617).",
};

module.exports = defineConfig([
  { ignores: ['src/app/api/generated/**', 'src/app/shared/icons/*.generated.ts'] },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'mf', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'mf', style: 'kebab-case' },
      ],
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {},
  },
  {
    // One toast API (S16, #617): the toast facade is `NotificationService` (plus `UndoService`); PrimeNG's `MessageService` has no host any more.
    files: ['src/**/*.ts'],
    ignores: ['src/app/features/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [MESSAGE_SERVICE_BAN] }],
    },
  },
  {
    // Features must not import from other features (architecture section 12).
    files: ['src/app/features/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [MESSAGE_SERVICE_BAN],
          patterns: [
            {
              group: ['**/features/*', '**/features/*/**'],
              message:
                'Features import from core, shared, api/generated and form-engine, never from other features.',
            },
          ],
        },
      ],
    },
  },
]);
