import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vite-plus/test';
import { moduleSpecifiers, productionModulePaths } from '../moduleSpecifiers.ts';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));

describe('private source module resolution', () => {
  it('resolves every private source import with native Node inside its owning package', () => {
    const imports = productionModulePaths().flatMap((file) =>
      moduleSpecifiers(file, readFileSync(resolve(repositoryRoot, file), 'utf8'))
        .filter((specifier) => specifier.startsWith('#'))
        .map((specifier) => ({ file, specifier })),
    );
    expect(imports.length).toBeGreaterThan(0);
    const result = spawnSync(
      process.execPath,
      [
        '--conditions=uapkg-source',
        '--input-type=module',
        '--eval',
        `import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, relative, resolve } from 'node:path';
const failures = [];
for (const { file, specifier } of JSON.parse(readFileSync(0, 'utf8'))) {
  try {
    const target = createRequire(resolve(file)).resolve(specifier);
    const sourceRoot = resolve(file.split('/').slice(0, 2).join('/'), 'src');
    const withinSource = relative(sourceRoot, target);
    if (withinSource.startsWith('..') || isAbsolute(withinSource)) {
      failures.push(file + ': ' + specifier + ' resolves outside its owner source');
    }
  } catch (error) {
    failures.push(file + ': ' + specifier + ': ' + error.message);
  }
}
console.log(JSON.stringify(failures));`,
      ],
      {
        cwd: repositoryRoot,
        input: JSON.stringify(imports),
        encoding: 'utf8',
        env: { ...process.env, NODE_OPTIONS: '' },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([]);
  });
});
