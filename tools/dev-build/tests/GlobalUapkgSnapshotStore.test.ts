import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { GlobalUapkgSnapshotStore } from '../GlobalUapkgSnapshotStore';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe('GlobalUapkgSnapshotStore', () => {
  it('writes snapshots with the scoped CLI package name', () => {
    const workspaceRoot = makeTemporaryDirectory();
    const store = new GlobalUapkgSnapshotStore(workspaceRoot);

    store.write({ kind: 'published', version: '1.2.3' });

    expect(store.read()).toMatchObject({
      workspaceRoot,
      packageName: '@uapkg/cli',
      previous: {
        kind: 'published',
        version: '1.2.3',
      },
    });
  });

  it('continues reading snapshots created before the package rename migration', () => {
    const workspaceRoot = makeTemporaryDirectory();
    const store = new GlobalUapkgSnapshotStore(workspaceRoot);
    const snapshotPath = store.getSnapshotPath();
    const legacySnapshot = {
      createdAt: '2026-04-25T00:00:00.000Z',
      workspaceRoot,
      packageName: 'uapkg',
      previous: {
        kind: 'none',
      },
    };

    fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
    fs.writeFileSync(snapshotPath, JSON.stringify(legacySnapshot), 'utf8');

    expect(store.read()).toEqual(legacySnapshot);
  });
});

function makeTemporaryDirectory() {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'uapkg-snapshot-'));
  temporaryDirectories.push(temporaryDirectory);
  return temporaryDirectory;
}
