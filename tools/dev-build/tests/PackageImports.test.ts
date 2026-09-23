import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vite-plus/test';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
const vitePlusCli = fileURLToPath(import.meta.resolve('vite-plus/bin'));
const typescriptCli = path.join(path.dirname(fileURLToPath(import.meta.resolve('typescript/package.json'))), 'bin/tsc');

describe('published package imports', () => {
  it('builds source aliases into runnable JavaScript and consumable declarations without shipping source', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'uapkg-package-imports-'));
    const source = path.join(directory, 'source');
    const consumer = path.join(directory, 'consumer');
    const installedPackage = path.join(consumer, 'node_modules/@uapkg/import-fixture');
    const manifest = {
      name: '@uapkg/import-fixture',
      type: 'module',
      exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' } },
      imports: {
        '#fixture/*.ts': { 'uapkg-source': './src/*.ts', types: './dist/*.d.ts', default: './dist/*.js' },
        '#fixture/*.tsx': { 'uapkg-source': './src/*.tsx', types: './dist/*.d.ts', default: './dist/*.js' },
      },
    };
    const env = { ...process.env, NODE_OPTIONS: '' };
    const sourceConfig = JSON.parse(readFileSync(path.join(repositoryRoot, 'tsconfig.base.json'), 'utf8')) as {
      compilerOptions: Record<string, unknown>;
    };
    try {
      mkdirSync(path.join(source, 'src'), { recursive: true });
      writeFileSync(path.join(source, 'package.json'), JSON.stringify(manifest));
      writeFileSync(
        path.join(source, 'vite.config.ts'),
        `export { default } from ${JSON.stringify(path.join(repositoryRoot, 'vite.config.ts').replaceAll('\\', '/'))};\n`,
      );
      writeFileSync(
        path.join(source, 'tsconfig.pack.json'),
        JSON.stringify({
          compilerOptions: { ...sourceConfig.compilerOptions, paths: {}, jsx: 'preserve', types: [] },
          include: ['src/**/*'],
        }),
      );
      writeFileSync(
        path.join(source, 'src/index.ts'),
        "export { value } from '#fixture/value.ts';\n" +
          "export type { Shape } from '#fixture/types.ts';\n" +
          "export { view } from '#fixture/view.tsx';\n" +
          "export async function dynamic() { return await import('#fixture/value.ts'); }\n",
      );
      writeFileSync(path.join(source, 'src/types.ts'), 'export interface Shape { key: string }\n');
      writeFileSync(
        path.join(source, 'src/value.ts'),
        "import type { Shape } from '#fixture/types.ts'; export const value: Shape = { key: 'ok' };\n",
      );
      writeFileSync(
        path.join(source, 'src/view.tsx'),
        "import { value } from '#fixture/value.ts'; export const view = () => value;\n",
      );
      execFileSync(process.execPath, [vitePlusCli, 'pack'], {
        cwd: source,
        env,
        encoding: 'utf8',
        timeout: 20_000,
      });

      mkdirSync(installedPackage, { recursive: true });
      cpSync(path.join(source, 'package.json'), path.join(installedPackage, 'package.json'));
      cpSync(path.join(source, 'dist'), path.join(installedPackage, 'dist'), { recursive: true });
      writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
      const output = execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '--eval',
          'import { createRequire } from "node:module"; ' +
            'const { value, view, dynamic } = await import("@uapkg/import-fixture"); ' +
            'const require = createRequire(new URL("./node_modules/@uapkg/import-fixture/dist/index.js", import.meta.url)); ' +
            'console.log(value.key, view().key, (await dynamic()).value.key, require("#fixture/value.ts").value.key);',
        ],
        { cwd: consumer, env, encoding: 'utf8', timeout: 10_000 },
      );
      expect(output.trim()).toBe('ok ok ok ok');
      writeFileSync(
        path.join(consumer, 'index.ts'),
        'import { value, view, dynamic, type Shape } from "@uapkg/import-fixture";\n' +
          'const values: Shape[] = [value, view(), (await dynamic()).value]; void values;\n',
      );
      writeFileSync(
        path.join(consumer, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: { module: 'NodeNext', target: 'ES2022', strict: true, noEmit: true, types: [] },
          include: ['index.ts'],
        }),
      );
      execFileSync(process.execPath, [typescriptCli, '-p', 'tsconfig.json'], {
        cwd: consumer,
        env,
        encoding: 'utf8',
        timeout: 10_000,
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
