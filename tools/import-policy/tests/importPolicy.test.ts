import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vite-plus/test';
import configuration from '../../../vite.config.ts';
import { productionModulePaths, relativeModuleImports } from '../moduleSpecifiers.ts';
import { importPolicyOverrides } from '../policy.ts';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const toolchainRequire = createRequire(import.meta.resolve('vite-plus'));
const oxlint = join(dirname(toolchainRequire.resolve('oxlint/package.json')), 'bin/oxlint');

interface LintResult {
  readonly status: number | null;
  readonly number_of_files: number;
  readonly diagnostics: readonly {
    readonly severity: string;
    readonly labels: readonly { readonly span: { readonly line: number } }[];
  }[];
}

function lintFixtures(files: Record<string, string>): LintResult {
  const fixture = mkdtempSync(join(tmpdir(), 'uapkg-import-policy-'));
  try {
    for (const [path, content] of Object.entries(files)) {
      const file = join(fixture, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    }
    const config = join(fixture, '.oxlintrc.json');
    writeFileSync(
      config,
      JSON.stringify({
        plugins: ['eslint', 'typescript'],
        categories: { correctness: 'off' },
        overrides: importPolicyOverrides,
      }),
    );
    const result = spawnSync(process.execPath, [oxlint, '-c', config, '.', '--format', 'json'], {
      cwd: fixture,
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe('');
    return { status: result.status, ...(JSON.parse(result.stdout) as Omit<LintResult, 'status'>) };
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

describe('production module import policy', () => {
  it('enables the policy in the ordinary root lint configuration', () => {
    expect(configuration.lint?.overrides).toEqual(importPolicyOverrides);
  });

  it('rejects sibling/parent imports, types, re-exports, side effects and literal dynamic/require forms once', () => {
    const result = lintFixtures({
      'packages/example/src/forms.ts': [
        "import a from './a'",
        "import type { B } from '../b'",
        "import './side-effect'",
        "export { c } from './c'",
        "export type { D } from '../d'",
        "export * from './e'",
        "export * as f from '../f'",
        "const g = import('./g')",
        "const h = require('../h')",
        "import i = require('./i')",
        'const j = require(`./j`)',
        "import type { K } from '.'",
        "export * from '..'",
        "import './helper.css.ts'",
      ].join('\n'),
      'packages/example/src/view.tsx': "import './view'",
    });
    expect(result.status).toBe(1);
    expect(result.number_of_files).toBe(2);
    expect(result.diagnostics).toHaveLength(15);
    expect(result.diagnostics.every((diagnostic) => diagnostic.severity === 'error')).toBe(true);
    expect(result.diagnostics.map((diagnostic) => diagnostic.labels[0].span.line).sort((a, b) => a - b)).toEqual([
      1,
      ...Array.from({ length: 14 }, (_, index) => index + 1),
    ]);
  });

  it('allows canonical imports, resources, tests, fixtures, generated source and bootstrap tools', () => {
    const result = lintFixtures({
      'packages/example/src/accepted.ts': [
        "import local from '#example/local.ts'",
        "import type { T } from '@uapkg/common'",
        "export { value } from '@uapkg/common'",
        "export * from '#example/module.ts'",
        "const dynamic = import('#example/lazy.ts')",
        "const builtin = require('node:path')",
        "import external = require('@uapkg/common')",
        "import './style.css'",
        "import styleUrl from '../style.css?url'",
        "import logo from './logo.svg'",
        "const icon = require('../icon.svg')",
        "const font = require('./font.woff2?url')",
        "import image = require('./image.png')",
        "const path = '../not-a-module'",
        "const resource = new URL('../file.bin', import.meta.url)",
      ].join('\n'),
      'packages/example/src/local.test.ts': "import './subject'",
      'packages/example/src/local.spec.tsx': "import './subject'",
      'packages/example/src/__fixtures__/fixture.ts': "import './subject'",
      'packages/example/src/tests/fixture.ts': "import './subject'",
      'packages/example/src/generated.gen.ts': "import './generated'",
      'packages/example/build/build.ts': "import './bootstrap'",
      'packages/example/vite.config.ts': "import './bootstrap'",
      'tools/bootstrap.ts': "import './helper'",
    });
    expect(result.status).toBe(0);
    expect(result.diagnostics).toEqual([]);
    expect(result.number_of_files).toBe(9);
  });

  it('covers parser gaps without treating URLs, resource queries or ordinary strings as module imports', () => {
    const source = [
      'const load = factory(import.meta.url)',
      "import { createRequire as factory } from 'node:module'",
      "import * as nodeModule from 'node:module'",
      'const loadOther = nodeModule.createRequire(import.meta.url)',
      "const a = load('./a')",
      'const b = import(`../b`)',
      "type C = import('./c').C",
      "const d = module.require('../d')",
      "const e = require.resolve('./e')",
      "const f = loadOther('./f')",
      "const resource = new URL('../resource.json', import.meta.url)",
      "const text = './ordinary-string'",
      "import './style.css'",
      "import './style.css?url'",
      "import './helper.css.ts'",
    ].join('\n');
    expect(relativeModuleImports('module.ts', source)).toEqual([
      './a',
      '../b',
      './c',
      '../d',
      './e',
      './f',
      './helper.css.ts',
    ]);
    expect(relativeModuleImports('view.tsx', "export const View = () => <div>{import('./content')}</div>")).toEqual([
      './content',
    ]);
  });

  it('keeps hand-written production modules free of relative imports, including native lint gaps', () => {
    const violations: string[] = [];
    for (const path of productionModulePaths()) {
      for (const specifier of relativeModuleImports(path, readFileSync(resolve(repositoryRoot, path), 'utf8'))) {
        violations.push(`${path}: ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });
});
