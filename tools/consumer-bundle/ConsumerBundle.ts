import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { satisfies, valid } from 'semver';

export const BUNDLE_MANIFEST_FILE = 'uapkg-bundle.json';
export const BUNDLE_SCHEMA_VERSION = 1 as const;

export type DependencyMap = Record<string, string>;

export interface WorkspacePackage {
  name: string;
  version: string;
  directory: string;
  projectName: string;
  dependencies: DependencyMap;
  optionalDependencies: DependencyMap;
}

export interface BundlePackage {
  name: string;
  version: string;
  file: string;
  sha256: string;
  dependencies: DependencyMap;
  optionalDependencies: DependencyMap;
}

export interface ConsumerBundleManifestData {
  schemaVersion: typeof BUNDLE_SCHEMA_VERSION;
  repository: string;
  requestedRef: string;
  commit: string;
  dirty: boolean;
  dirtyContentDigest: string | null;
  consumer: {
    name: string | null;
    version: string | null;
    manifestSha256: string;
  };
  roots: string[];
  packages: BundlePackage[];
}

export interface ConsumerBundleManifest extends ConsumerBundleManifestData {
  bundleDigest: string;
}

export interface GitIdentity {
  repository: string;
  commit: string;
  dirty: boolean;
  dirtyContentDigest: string | null;
}

export interface CreateConsumerBundleOptions {
  workspaceRoot: string;
  consumerManifestPath: string;
  outputDirectory: string;
  requestedRef: string;
  roots?: readonly string[];
  repository?: string;
  expectedCommit?: string;
  ci: boolean;
}

type JsonObject = Record<string, unknown>;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const COMMIT_PATTERN = /^[a-f0-9]{40}$/i;

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function asObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return value as JsonObject;
}

function asOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function readJsonObject(filePath: string, label: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read ${label} at ${filePath}`, { cause: error });
  }
  return asObject(parsed, label);
}

export function readDependencyMap(value: unknown, label: string): DependencyMap {
  if (value === undefined) {
    return {};
  }
  const object = asObject(value, label);
  const result: DependencyMap = {};
  for (const name of Object.keys(object).sort()) {
    const range = object[name];
    if (typeof range !== 'string' || range.length === 0) {
      throw new Error(`${label}.${name} must be a non-empty string`);
    }
    result[name] = range;
  }
  return result;
}

function runCaptured(command: string, args: readonly string[], cwd: string): string {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const output = error as { stderr?: Buffer | string; stdout?: Buffer | string };
    const details = String(output.stderr ?? output.stdout ?? '').trim();
    throw new Error(`Command failed: ${command} ${args.join(' ')}${details ? `\n${details}` : ''}`, { cause: error });
  }
}

interface CommandInvocation {
  command: string;
  prefixArgs: string[];
}

let cachedPnpmInvocation: CommandInvocation | undefined;

function pnpmInvocation(): CommandInvocation {
  if (cachedPnpmInvocation) {
    return cachedPnpmInvocation;
  }

  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && /pnpm/i.test(npmExecPath) && existsSync(npmExecPath)) {
    cachedPnpmInvocation = { command: process.execPath, prefixArgs: [npmExecPath] };
    return cachedPnpmInvocation;
  }

  if (process.platform === 'win32') {
    const shims = runCaptured('where.exe', ['pnpm.cmd'], process.cwd())
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    for (const shim of shims) {
      const shimDirectory = path.dirname(shim);
      const contents = readFileSync(shim, 'utf8');
      const relativeEntrypoints = [...contents.matchAll(/%dp0%\\([^"\r\n]+\.(?:mjs|cjs|js))/gi)].map(
        (match) => match[1],
      );
      for (const relativeEntrypoint of relativeEntrypoints) {
        if (!relativeEntrypoint) {
          continue;
        }
        const entrypoint = path.resolve(shimDirectory, relativeEntrypoint);
        if (existsSync(entrypoint)) {
          cachedPnpmInvocation = { command: process.execPath, prefixArgs: [entrypoint] };
          return cachedPnpmInvocation;
        }
      }
    }
    throw new Error('Unable to locate the pnpm JavaScript entrypoint from pnpm.cmd');
  }

  cachedPnpmInvocation = { command: 'pnpm', prefixArgs: [] };
  return cachedPnpmInvocation;
}

function runPnpmCaptured(args: readonly string[], cwd: string): string {
  const invocation = pnpmInvocation();
  return runCaptured(invocation.command, [...invocation.prefixArgs, ...args], cwd);
}

function runPnpmInherited(args: readonly string[], cwd: string): void {
  const invocation = pnpmInvocation();
  runInherited(invocation.command, [...invocation.prefixArgs, ...args], cwd);
}

function runInherited(command: string, args: readonly string[], cwd: string): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
  });
  if (result.error) {
    throw new Error(`Unable to run ${command} ${args.join(' ')}`, { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status ?? 'unknown exit'}): ${command} ${args.join(' ')}`);
  }
}

function normalizeRepository(remote: string): string {
  const trimmed = remote.trim().replace(/\.git$/, '');
  const scpLike = trimmed.match(/^[^@]+@github\.com:(.+)$/i);
  if (scpLike?.[1]) {
    return scpLike[1];
  }
  try {
    const url = new URL(trimmed);
    if (url.hostname.toLowerCase() === 'github.com') {
      return url.pathname.replace(/^\//, '');
    }
  } catch {
    // Non-URL remotes remain useful provenance and are returned below.
  }
  return trimmed;
}

function runGitBuffer(workspaceRoot: string, args: readonly string[]): Buffer {
  try {
    return execFileSync('git', args, {
      cwd: workspaceRoot,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new Error(`Git command failed: git ${args.join(' ')}`, { cause: error });
  }
}

function splitNullTerminated(value: Buffer): string[] {
  return value
    .toString('utf8')
    .split('\0')
    .filter((entry) => entry.length > 0);
}

export function computeGitIdentity(workspaceRoot: string, expectedRepository?: string): GitIdentity {
  const commit = runGitBuffer(workspaceRoot, ['rev-parse', 'HEAD']).toString('utf8').trim().toLowerCase();
  if (!COMMIT_PATTERN.test(commit)) {
    throw new Error(`Git returned an invalid commit identifier: ${commit}`);
  }

  const status = runGitBuffer(workspaceRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const dirty = status.length > 0;
  let dirtyContentDigest: string | null = null;
  if (dirty) {
    const digest = createHash('sha256');
    digest.update('uapkg-dirty-tree-v1\0');
    digest.update(status);
    digest.update('\0tracked-diff\0');
    digest.update(runGitBuffer(workspaceRoot, ['diff', '--binary', 'HEAD', '--']));

    const untracked = splitNullTerminated(
      runGitBuffer(workspaceRoot, ['ls-files', '--others', '--exclude-standard', '-z']),
    ).sort();
    for (const relativePath of untracked) {
      const absolutePath = path.resolve(workspaceRoot, relativePath);
      digest.update('\0untracked-path\0');
      digest.update(relativePath);
      digest.update('\0');
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        digest.update('symlink\0');
        digest.update(readlinkSync(absolutePath));
      } else {
        digest.update('file\0');
        digest.update(readFileSync(absolutePath));
      }
    }
    dirtyContentDigest = digest.digest('hex');
  }

  const repository = normalizeRepository(runGitBuffer(workspaceRoot, ['remote', 'get-url', 'origin']).toString('utf8'));
  if (!repository) {
    throw new Error('Repository identity must not be empty');
  }
  if (expectedRepository !== undefined) {
    const expected = normalizeRepository(expectedRepository);
    if (repository.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(`Expected repository ${expected}, but the checkout origin is ${repository}`);
    }
  }

  return { repository, commit, dirty, dirtyContentDigest };
}

export function assertSourcePolicy(
  identity: Pick<GitIdentity, 'commit' | 'dirty'>,
  options: Pick<CreateConsumerBundleOptions, 'ci' | 'expectedCommit'>,
): void {
  if (options.expectedCommit !== undefined) {
    if (!COMMIT_PATTERN.test(options.expectedCommit)) {
      throw new Error('--expected-commit must be an exact 40-character Git SHA');
    }
    if (identity.commit !== options.expectedCommit.toLowerCase()) {
      throw new Error(`Expected UAPKG commit ${options.expectedCommit}, but checked out ${identity.commit}`);
    }
  }
  if (options.ci && options.expectedCommit === undefined) {
    throw new Error('--ci requires --expected-commit with an exact 40-character Git SHA');
  }
  if (options.ci && identity.dirty) {
    throw new Error('CI bundle creation requires a clean UAPKG working tree');
  }
}

export function assertGitIdentityUnchanged(before: GitIdentity, after: GitIdentity): void {
  if (
    before.repository !== after.repository ||
    before.commit !== after.commit ||
    before.dirty !== after.dirty ||
    before.dirtyContentDigest !== after.dirtyContentDigest
  ) {
    throw new Error('UAPKG source identity changed while the consumer bundle was being built');
  }
}

interface PnpmWorkspaceEntry {
  name?: unknown;
  version?: unknown;
  path?: unknown;
}

export function discoverWorkspacePackages(workspaceRoot: string): Map<string, WorkspacePackage> {
  let listed: unknown;
  try {
    listed = JSON.parse(runPnpmCaptured(['-r', 'list', '--depth', '-1', '--json'], workspaceRoot));
  } catch (error) {
    throw new Error('Unable to discover pnpm workspace packages', { cause: error });
  }
  if (!Array.isArray(listed)) {
    throw new Error('pnpm workspace listing was not an array');
  }

  const packages = new Map<string, WorkspacePackage>();
  for (const rawEntry of listed as PnpmWorkspaceEntry[]) {
    if (typeof rawEntry.name !== 'string' || !rawEntry.name.startsWith('@uapkg/')) {
      continue;
    }
    if (typeof rawEntry.path !== 'string') {
      throw new Error(`Workspace package ${rawEntry.name} has no path`);
    }
    const manifest = readJsonObject(path.join(rawEntry.path, 'package.json'), `workspace package ${rawEntry.name}`);
    const projectPath = path.join(rawEntry.path, 'project.json');
    const project = existsSync(projectPath)
      ? readJsonObject(projectPath, `Nx project for ${rawEntry.name}`)
      : undefined;
    const name = asOptionalString(manifest.name, `${rawEntry.name}.name`);
    const version = asOptionalString(manifest.version, `${rawEntry.name}.version`);
    const projectName = project ? asOptionalString(project.name, `${rawEntry.name} Nx project name`) : name;
    if (!name || name !== rawEntry.name || !version || !projectName) {
      throw new Error(`Workspace metadata is incomplete or inconsistent for ${rawEntry.name}`);
    }
    if (packages.has(name)) {
      throw new Error(`Duplicate workspace package ${name}`);
    }
    packages.set(name, {
      name,
      version,
      directory: path.resolve(rawEntry.path),
      projectName,
      dependencies: readDependencyMap(manifest.dependencies, `${name}.dependencies`),
      optionalDependencies: readDependencyMap(manifest.optionalDependencies, `${name}.optionalDependencies`),
    });
  }
  if (packages.size === 0) {
    throw new Error('No @uapkg workspace packages were discovered');
  }
  return packages;
}

function internalRuntimeDependencies(pkg: WorkspacePackage): string[] {
  return [...new Set([...Object.keys(pkg.dependencies), ...Object.keys(pkg.optionalDependencies)])]
    .filter((name) => name.startsWith('@uapkg/'))
    .sort();
}

export function resolveRuntimeClosure(
  packages: ReadonlyMap<string, WorkspacePackage>,
  requestedRoots: readonly string[],
): WorkspacePackage[] {
  const roots = [...new Set(requestedRoots)].sort();
  if (roots.length === 0) {
    throw new Error('At least one @uapkg runtime root is required');
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const ordered: WorkspacePackage[] = [];

  const visit = (name: string): void => {
    const pkg = packages.get(name);
    if (!pkg) {
      throw new Error(`Internal runtime package ${name} is not present in the UAPKG workspace`);
    }
    if (visited.has(name)) {
      return;
    }
    if (visiting.has(name)) {
      throw new Error(`Internal runtime dependency cycle detected at ${name}`);
    }
    visiting.add(name);
    for (const dependency of internalRuntimeDependencies(pkg)) {
      visit(dependency);
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push(pkg);
  };

  for (const root of roots) {
    if (!root.startsWith('@uapkg/')) {
      throw new Error(`Bundle root must be an @uapkg package: ${root}`);
    }
    visit(root);
  }
  return ordered;
}

export function selectConsumerRoots(consumerManifest: JsonObject, explicitRoots?: readonly string[]): string[] {
  const dependencies = readDependencyMap(consumerManifest.dependencies, 'consumer.dependencies');
  const optionalDependencies = readDependencyMap(
    consumerManifest.optionalDependencies,
    'consumer.optionalDependencies',
  );
  const declared = new Set([...Object.keys(dependencies), ...Object.keys(optionalDependencies)]);
  const roots = explicitRoots?.length
    ? [...new Set(explicitRoots)].sort()
    : [...declared].filter((name) => name.startsWith('@uapkg/')).sort();

  for (const root of roots) {
    if (!root.startsWith('@uapkg/')) {
      throw new Error(`Bundle root must be an @uapkg package: ${root}`);
    }
    if (!declared.has(root)) {
      throw new Error(`Requested root ${root} is not a runtime dependency of the consumer`);
    }
  }
  if (roots.length === 0) {
    throw new Error('The consumer has no @uapkg runtime dependencies');
  }
  return roots;
}

export function assertConsumerRootCompatibility(
  consumerManifest: JsonObject,
  roots: readonly string[],
  workspacePackages: ReadonlyMap<string, WorkspacePackage>,
): void {
  const dependencies = readDependencyMap(consumerManifest.dependencies, 'consumer.dependencies');
  const optionalDependencies = readDependencyMap(
    consumerManifest.optionalDependencies,
    'consumer.optionalDependencies',
  );
  for (const root of roots) {
    const sourcePackage = workspacePackages.get(root);
    if (!sourcePackage) {
      throw new Error(`Consumer root ${root} is not present in the UAPKG workspace`);
    }
    const requestedRange = dependencies[root] ?? optionalDependencies[root];
    if (!requestedRange) {
      throw new Error(`Consumer root ${root} has no declared runtime dependency range`);
    }
    if (!valid(sourcePackage.version)) {
      throw new Error(`UAPKG source package ${root} has an invalid version: ${sourcePackage.version}`);
    }
    if (!satisfies(sourcePackage.version, requestedRange)) {
      throw new Error(
        `UAPKG source package ${root}@${sourcePackage.version} does not satisfy the consumer range ${requestedRange}`,
      );
    }
  }
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const object = asObject(value, 'canonical JSON value');
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

function sortedJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sortedJsonValue(entry));
  }
  if (value !== null && typeof value === 'object') {
    const object = asObject(value, 'JSON value');
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .map((key) => [key, sortedJsonValue(object[key])]),
    );
  }
  return value;
}

function tarEntryName(header: Buffer): string {
  const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/u, '');
  const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/u, '');
  return (prefix ? `${prefix}/${name}` : name).replace(/^\.\//u, '');
}

function readTarOctal(header: Buffer, start: number, length: number): number {
  const raw = header
    .subarray(start, start + length)
    .toString('ascii')
    .replaceAll('\0', '')
    .trim();
  const value = raw.length === 0 ? 0 : Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Packed tarball contains an invalid entry size');
  }
  return value;
}

function writeTarSizeAndChecksum(header: Buffer, size: number): void {
  const octalSize = size.toString(8);
  if (octalSize.length > 11) {
    throw new Error('Canonical packed package manifest is too large for a portable tar header');
  }
  header.fill(0, 124, 136);
  header.write(`${octalSize.padStart(11, '0')}\0`, 124, 12, 'ascii');
  header.fill(0x20, 148, 156);
  const checksum = header.reduce((total, byte) => total + byte, 0).toString(8);
  if (checksum.length > 6) {
    throw new Error('Packed tarball header checksum is not portable');
  }
  header.write(checksum.padStart(6, '0'), 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
}

/**
 * pnpm supplies the publish manifest rewrite, but its dependency key iteration can vary by graph traversal order.
 * Canonicalize only the packed package.json and retain every other publish tar entry/header byte.
 */
export function normalizePackedTarball(tarballPath: string): void {
  const rawTar = gunzipSync(readFileSync(tarballPath));
  const output: Buffer[] = [];
  let offset = 0;
  let manifestCount = 0;
  while (offset + 512 <= rawTar.length) {
    const originalHeader = rawTar.subarray(offset, offset + 512);
    if (originalHeader.every((byte) => byte === 0)) {
      break;
    }
    const header = Buffer.from(originalHeader);
    const size = readTarOctal(header, 124, 12);
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > rawTar.length) {
      throw new Error('Packed tarball entry exceeds the archive boundary');
    }
    let body = rawTar.subarray(bodyStart, bodyEnd);
    const type = String.fromCharCode(header[156] || 48);
    if (type === '0' && tarEntryName(header) === 'package/package.json') {
      const parsed = JSON.parse(body.toString('utf8')) as unknown;
      body = Buffer.from(JSON.stringify(sortedJsonValue(parsed), null, 2), 'utf8');
      writeTarSizeAndChecksum(header, body.length);
      manifestCount += 1;
    }
    output.push(header, body);
    const padding = (512 - (body.length % 512)) % 512;
    if (padding > 0) {
      output.push(Buffer.alloc(padding));
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  if (manifestCount !== 1) {
    throw new Error(`Packed tarball must contain exactly one package/package.json; found ${manifestCount}`);
  }
  output.push(Buffer.alloc(1024));
  const compressed = gzipSync(Buffer.concat(output), { level: 9 });
  compressed.fill(0, 4, 8);
  compressed[9] = 0xff;
  writeFileSync(tarballPath, compressed);
}

export function computeBundleDigest(data: ConsumerBundleManifestData): string {
  return sha256(canonicalJson(data));
}

export function createContentAddressedFilename(name: string, version: string, digest: string): string {
  if (!SHA256_PATTERN.test(digest)) {
    throw new Error(`Invalid tarball SHA-256 for ${name}`);
  }
  const readableName = name.replace(/^@/, '').replaceAll('/', '-');
  if (!/^[a-z0-9._-]+$/i.test(readableName) || !/^[a-z0-9.+_-]+$/i.test(version)) {
    throw new Error(`Package identity cannot be represented safely in a bundle filename: ${name}@${version}`);
  }
  return `${readableName}-${version}-${digest}.tgz`;
}

interface PackedManifest {
  name: string;
  version: string;
  dependencies: DependencyMap;
  optionalDependencies: DependencyMap;
}

export function validatePackedManifest(
  rawManifest: unknown,
  expectedPackage: Pick<WorkspacePackage, 'name' | 'version'>,
): PackedManifest {
  const manifest = asObject(rawManifest, `packed manifest for ${expectedPackage.name}`);
  const name = asOptionalString(manifest.name, 'packed package name');
  const version = asOptionalString(manifest.version, 'packed package version');
  if (name !== expectedPackage.name || version !== expectedPackage.version) {
    throw new Error(
      `Packed identity mismatch: expected ${expectedPackage.name}@${expectedPackage.version}, received ${name}@${version}`,
    );
  }

  for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'] as const) {
    const dependencies = readDependencyMap(manifest[field], `packed ${expectedPackage.name}.${field}`);
    for (const [dependency, range] of Object.entries(dependencies)) {
      if (range.startsWith('workspace:')) {
        throw new Error(`pnpm did not rewrite ${expectedPackage.name}'s workspace range for ${dependency}: ${range}`);
      }
    }
  }
  return {
    name,
    version,
    dependencies: readDependencyMap(manifest.dependencies, `packed ${expectedPackage.name}.dependencies`),
    optionalDependencies: readDependencyMap(
      manifest.optionalDependencies,
      `packed ${expectedPackage.name}.optionalDependencies`,
    ),
  };
}

function readPackedManifest(tarballPath: string, expectedPackage: WorkspacePackage): PackedManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(runCaptured('tar', ['-xOf', tarballPath, 'package/package.json'], expectedPackage.directory));
  } catch (error) {
    throw new Error(`Unable to inspect packed manifest for ${expectedPackage.name}`, { cause: error });
  }
  return validatePackedManifest(parsed, expectedPackage);
}

export function verifyCompletePackedClosure(packages: readonly BundlePackage[]): void {
  const bundledNames = new Set(packages.map((pkg) => pkg.name));
  if (bundledNames.size !== packages.length) {
    throw new Error('Bundle contains duplicate package names');
  }
  for (const pkg of packages) {
    for (const dependency of [...Object.keys(pkg.dependencies), ...Object.keys(pkg.optionalDependencies)]) {
      if (dependency.startsWith('@uapkg/') && !bundledNames.has(dependency)) {
        throw new Error(`Bundle is missing transitive runtime package ${dependency}, required by ${pkg.name}`);
      }
    }
  }
}

export function verifyBundleFiles(outputDirectory: string, packages: readonly BundlePackage[]): void {
  for (const pkg of packages) {
    if (path.basename(pkg.file) !== pkg.file) {
      throw new Error(`Bundle file must be a basename: ${pkg.file}`);
    }
    const tarballPath = path.join(outputDirectory, pkg.file);
    if (!existsSync(tarballPath)) {
      throw new Error(`Bundle tarball is missing: ${pkg.file}`);
    }
    const actual = sha256(readFileSync(tarballPath));
    if (actual !== pkg.sha256) {
      throw new Error(`Bundle tarball checksum mismatch for ${pkg.name}: expected ${pkg.sha256}, received ${actual}`);
    }
  }
}

function buildClosure(workspaceRoot: string, closure: readonly WorkspacePackage[]): void {
  const projects = [...new Set(closure.map((pkg) => pkg.projectName))].sort();
  runPnpmInherited(
    ['exec', 'nx', 'run-many', '--target=build', `--projects=${projects.join(',')}`, '--outputStyle=static'],
    workspaceRoot,
  );
}

function packClosure(closure: readonly WorkspacePackage[], temporaryDirectory: string): BundlePackage[] {
  const packed: BundlePackage[] = [];
  for (const pkg of [...closure].sort((left, right) => left.name.localeCompare(right.name))) {
    const temporaryTarball = path.join(temporaryDirectory, `${packed.length}.tgz`);
    runPnpmCaptured(['--dir', pkg.directory, 'pack', '--out', temporaryTarball], pkg.directory);
    normalizePackedTarball(temporaryTarball);
    const packedManifest = readPackedManifest(temporaryTarball, pkg);
    const tarballDigest = sha256(readFileSync(temporaryTarball));
    const file = createContentAddressedFilename(pkg.name, pkg.version, tarballDigest);
    const addressedTarball = path.join(temporaryDirectory, file);
    renameSync(temporaryTarball, addressedTarball);
    packed.push({
      name: pkg.name,
      version: pkg.version,
      file,
      sha256: tarballDigest,
      dependencies: packedManifest.dependencies,
      optionalDependencies: packedManifest.optionalDependencies,
    });
  }
  verifyCompletePackedClosure(packed);
  return packed;
}

export function publishBundle(
  temporaryDirectory: string,
  outputDirectory: string,
  manifest: ConsumerBundleManifest,
): void {
  mkdirSync(outputDirectory, { recursive: true });
  for (const pkg of manifest.packages) {
    copyFileSync(path.join(temporaryDirectory, pkg.file), path.join(outputDirectory, pkg.file));
  }
  verifyBundleFiles(outputDirectory, manifest.packages);

  const manifestPath = path.join(outputDirectory, BUNDLE_MANIFEST_FILE);
  const temporaryManifest = `${manifestPath}.tmp-${process.pid}`;
  writeFileSync(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  if (existsSync(manifestPath)) {
    unlinkSync(manifestPath);
  }
  renameSync(temporaryManifest, manifestPath);

  const expectedTarballs = new Set(manifest.packages.map((pkg) => pkg.file));
  for (const entry of readdirSync(outputDirectory)) {
    if (entry.endsWith('.tgz') && !expectedTarballs.has(entry)) {
      unlinkSync(path.join(outputDirectory, entry));
    }
  }
}

export function createConsumerBundle(options: CreateConsumerBundleOptions): ConsumerBundleManifest {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const consumerManifestPath = path.resolve(options.consumerManifestPath);
  const outputDirectory = path.resolve(options.outputDirectory);
  const identity = computeGitIdentity(workspaceRoot, options.repository);
  assertSourcePolicy(identity, options);

  const consumerBytes = readFileSync(consumerManifestPath);
  const consumerManifest = asObject(JSON.parse(consumerBytes.toString('utf8')), 'consumer manifest');
  const roots = selectConsumerRoots(consumerManifest, options.roots);
  const workspacePackages = discoverWorkspacePackages(workspaceRoot);
  assertConsumerRootCompatibility(consumerManifest, roots, workspacePackages);
  const closure = resolveRuntimeClosure(workspacePackages, roots);

  buildClosure(workspaceRoot, closure);
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'uapkg-consumer-bundle-'));
  try {
    const packages = packClosure(closure, temporaryDirectory);
    const finalIdentity = computeGitIdentity(workspaceRoot, options.repository);
    assertGitIdentityUnchanged(identity, finalIdentity);
    const data: ConsumerBundleManifestData = {
      schemaVersion: BUNDLE_SCHEMA_VERSION,
      repository: identity.repository,
      requestedRef: options.requestedRef,
      commit: identity.commit,
      dirty: identity.dirty,
      dirtyContentDigest: identity.dirtyContentDigest,
      consumer: {
        name: asOptionalString(consumerManifest.name, 'consumer.name') ?? null,
        version: asOptionalString(consumerManifest.version, 'consumer.version') ?? null,
        manifestSha256: sha256(consumerBytes),
      },
      roots,
      packages,
    };
    const manifest: ConsumerBundleManifest = {
      ...data,
      bundleDigest: computeBundleDigest(data),
    };
    publishBundle(temporaryDirectory, outputDirectory, manifest);
    return manifest;
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export function listBundleFiles(outputDirectory: string): string[] {
  return readdirSync(outputDirectory)
    .filter((entry) => entry === BUNDLE_MANIFEST_FILE || entry.endsWith('.tgz'))
    .sort();
}
