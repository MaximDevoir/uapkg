import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { c as createTar } from 'tar';
import { afterEach, describe, expect, it } from 'vitest';
import { readPackageClaimsFromArchive, readPackagedManifest } from '../src/index.js';

const cleanups: string[] = [];

async function makeArchive(entries: Record<string, string>, prefixDir = 'my-plugin-1.0.0'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'uapkg-claims-test-'));
  cleanups.push(dir);
  const contentRoot = join(dir, prefixDir);
  await writeFile(join(dir, '.keep'), '');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(contentRoot, { recursive: true });
  for (const [name, content] of Object.entries(entries)) {
    const filePath = join(contentRoot, name);
    await mkdir(join(filePath, '..'), { recursive: true });
    await writeFile(filePath, content, 'utf8');
  }
  const archivePath = join(dir, 'package.tgz');
  await createTar({ gzip: true, file: archivePath, cwd: dir, portable: true }, [prefixDir]);
  return archivePath;
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('readPackagedManifest', () => {
  it('reads the manifest under the pack prefix', async () => {
    const archive = await makeArchive({
      'uapkg.json': JSON.stringify({ name: 'my-plugin', version: '1.0.0', kind: 'plugin' }),
      'Source/readme.txt': 'hello',
    });
    const result = await readPackagedManifest(archive);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.entryPath.endsWith('uapkg.json')).toBe(true);
      expect((result.value.value as { name: string }).name).toBe('my-plugin');
    }
  });

  it('fails when the manifest is missing', async () => {
    const archive = await makeArchive({ 'Source/readme.txt': 'hello' });
    const result = await readPackagedManifest(archive);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe('CLAIMS_MANIFEST_MISSING');
  });

  it('fails on duplicate JSON keys in the packaged manifest', async () => {
    const archive = await makeArchive({
      'uapkg.json': '{"name": "my-plugin", "version": "1.0.0", "version": "2.0.0"}',
    });
    const result = await readPackagedManifest(archive);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe('CLAIMS_JSON_DUPLICATE_KEY');
  });

  it('fails on nonexistent archives', async () => {
    const result = await readPackagedManifest(join(tmpdir(), 'uapkg-claims-missing.tgz'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe('CLAIMS_ARCHIVE_READ_ERROR');
  });

  it('enforces the manifest size bound', async () => {
    const archive = await makeArchive({
      'uapkg.json': JSON.stringify({ name: 'my-plugin', version: '1.0.0', padding: 'x'.repeat(4096) }),
    });
    const result = await readPackagedManifest(archive, { maxManifestBytes: 128 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.diagnostics[0].code).toBe('CLAIMS_MANIFEST_TOO_LARGE');
  });

  it('ignores nested uapkg.json files below depth one', async () => {
    const archive = await makeArchive({
      'uapkg.json': JSON.stringify({ name: 'my-plugin', version: '1.0.0' }),
      'nested/deep/uapkg.json': JSON.stringify({ name: 'imposter', version: '9.9.9' }),
    });
    const result = await readPackagedManifest(archive);
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.value.value as { name: string }).name).toBe('my-plugin');
  });
});

describe('readPackageClaimsFromArchive', () => {
  it('produces normalized claims from the archive', async () => {
    const archive = await makeArchive({
      'uapkg.json': JSON.stringify({
        name: 'my-plugin',
        version: '1.0.0',
        kind: 'plugin',
        private: true,
        dependencies: { foo: { version: '^1.0.0', registry: 'default' } },
      }),
    });
    const result = await readPackageClaimsFromArchive(archive);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.private).toBe(true);
    expect(result.value.dependencies.foo).toEqual({ version: '^1.0.0' });
    expect(result.value.devDependencies).toEqual({});
  });
});
