import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type CreateConsumerBundleOptions, createConsumerBundle } from './ConsumerBundle';

interface CliOptions {
  consumer?: string;
  output?: string;
  requestedRef: string;
  roots: string[];
  repository?: string;
  expectedCommit?: string;
  ci: boolean;
  help: boolean;
}

const USAGE = `Create a publish-shaped UAPKG dependency bundle for an npm consumer.

Usage:
  pnpm deps:consumer-bundle -- --consumer <package.json> --output <directory> [options]

Options:
  --root <@uapkg/name>       Select a declared runtime root (repeatable; defaults to all)
  --requested-ref <ref>      Record the requested source ref (default: local)
  --repository <owner/repo>  Require this repository identity at the checkout origin
  --expected-commit <sha>    Require the exact 40-character checked-out commit
  --ci                       Require both an expected commit and a clean tree
  --help                     Show this help
`;

function optionValue(args: readonly string[], index: number, option: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

export function parseConsumerBundleOptions(rawArgs: readonly string[]): CliOptions {
  const args = rawArgs.filter((argument) => argument !== '--');
  const options: CliOptions = {
    requestedRef: 'local',
    roots: [],
    ci: false,
    help: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--ci') {
      options.ci = true;
    } else if (argument === '--help') {
      options.help = true;
    } else if (argument === '--consumer') {
      options.consumer = optionValue(args, index, argument);
      index += 1;
    } else if (argument === '--output') {
      options.output = optionValue(args, index, argument);
      index += 1;
    } else if (argument === '--requested-ref') {
      options.requestedRef = optionValue(args, index, argument);
      index += 1;
    } else if (argument === '--root') {
      options.roots.push(optionValue(args, index, argument));
      index += 1;
    } else if (argument === '--repository') {
      options.repository = optionValue(args, index, argument);
      index += 1;
    } else if (argument === '--expected-commit') {
      options.expectedCommit = optionValue(args, index, argument);
      index += 1;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

function resolveConsumerManifest(input: string): string {
  return input.endsWith('package.json') ? path.resolve(input) : path.resolve(input, 'package.json');
}

export function runConsumerBundleCli(): void {
  const parsed = parseConsumerBundleOptions(process.argv.slice(2));
  if (parsed.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (!parsed.consumer || !parsed.output) {
    throw new Error(`--consumer and --output are required\n\n${USAGE}`);
  }

  const options: CreateConsumerBundleOptions = {
    workspaceRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'),
    consumerManifestPath: resolveConsumerManifest(parsed.consumer),
    outputDirectory: path.resolve(parsed.output),
    requestedRef: parsed.requestedRef,
    roots: parsed.roots,
    repository: parsed.repository,
    expectedCommit: parsed.expectedCommit,
    ci: parsed.ci,
  };
  const manifest = createConsumerBundle(options);
  process.stdout.write(
    `[consumer-bundle] Wrote ${manifest.packages.length} packages to ${options.outputDirectory}\n` +
      `[consumer-bundle] Source ${manifest.repository}@${manifest.commit}${manifest.dirty ? ' (dirty)' : ''}\n` +
      `[consumer-bundle] Bundle ${manifest.bundleDigest}\n`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runConsumerBundleCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[consumer-bundle] ${message}\n`);
    process.exitCode = 1;
  }
}
