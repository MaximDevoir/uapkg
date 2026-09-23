import { matchesGlob } from 'node:path';
import type { OxlintOverride } from 'vite-plus/lint';

export const productionImportFiles = ['packages/*/src/**/*.{ts,tsx}'];
export const importPolicyExceptions = [
  '**/*.{test,spec}.{ts,tsx}',
  '**/{tests,__tests__,fixtures,__fixtures__,_fixtures}/**/*',
  '**/*.gen.{ts,tsx}',
];
const resourceExtensions = 'css,scss,sass,less,svg,png,jpg,jpeg,gif,webp,avif,ico,woff,woff2,ttf,otf';
const resourcePatterns = [`**/*.{${resourceExtensions}}`, `**/*.{${resourceExtensions}}[?]*`];

export const importPolicyOverrides = [
  {
    files: productionImportFiles,
    rules: {
      'eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['.', '..', './**', '../**', ...resourcePatterns.map((pattern) => `!${pattern}`)],
              message: 'Use this package’s # alias or a public @uapkg package export.',
            },
          ],
        },
      ],
      // The import rule handles import = require; this rule covers ordinary calls without duplicate diagnostics.
      'typescript/no-require-imports': [
        'error',
        {
          allow: ['^[^.]', `\\.(?:${resourceExtensions.replaceAll(',', '|')})(?:\\?.*)?$`],
          allowAsImport: true,
        },
      ],
    },
  },
  {
    // Colocated tests/fixtures can address their subjects directly; generated source retains its generator’s imports.
    files: importPolicyExceptions,
    rules: {
      'eslint/no-restricted-imports': 'off',
      'typescript/no-require-imports': 'off',
    },
  },
] satisfies OxlintOverride[];

export function isProductionModule(path: string): boolean {
  return (
    productionImportFiles.some((pattern) => matchesGlob(path, pattern)) &&
    !importPolicyExceptions.some((pattern) => matchesGlob(path, pattern))
  );
}

export function isRelativeModule(specifier: string): boolean {
  const resourcePath = specifier.replace(/^(?:\.\.?[/\\])+/u, '');
  return (
    /^\.\.?(?:[/\\]|$)/u.test(specifier) && !resourcePatterns.some((pattern) => matchesGlob(resourcePath, pattern))
  );
}
