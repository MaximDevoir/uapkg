import type { Argv } from 'yargs';
import { createUAPKGCommandLineFactory } from '../../UAPKGCommandLine.js';
import type { CommandLineSink, UAPKGCommandModule } from '../contracts/UAPKGCommandModule.js';
import { resolveScope, withScopeOptions } from './sharedOptions.js';

export class RegistryCommandModule implements UAPKGCommandModule {
  private readonly factory = createUAPKGCommandLineFactory();

  register(parser: Argv, sink: CommandLineSink) {
    return parser.command(
      'registry <action> [name] [url]',
      'Manage named registries',
      (builder) =>
        withScopeOptions(builder)
          .positional('action', {
            type: 'string',
            choices: ['add', 'remove', 'list', 'use', 'auth', 'refresh'] as const,
            describe: 'Registry action',
            demandOption: true,
          })
          .positional('name', {
            type: 'string',
            describe: 'Registry name',
          })
          .positional('url', {
            type: 'string',
            describe: 'Registry URL (for add)',
          })
          .option('branch', {
            type: 'string',
            describe: 'Registry git branch reference',
          })
          .option('tag', {
            type: 'string',
            describe: 'Registry git tag reference',
          })
          .option('rev', {
            type: 'string',
            describe: 'Registry git commit reference',
          })
          .option('json', {
            type: 'boolean',
            default: false,
            describe: 'Output JSON',
          })
          .conflicts('branch', 'tag')
          .conflicts('branch', 'rev')
          .conflicts('tag', 'rev')
          .check((argv) => {
            const action = String(argv.action);
            if (action === 'auth' || action === 'refresh') {
              if (argv.global || argv.local) {
                throw new Error(`[uapkg] registry ${action} does not accept --global or --local`);
              }
              if (typeof argv.url === 'string') {
                throw new Error(`[uapkg] registry ${action} accepts a configured alias only`);
              }
              if (typeof argv.branch === 'string' || typeof argv.tag === 'string' || typeof argv.rev === 'string') {
                throw new Error(`[uapkg] registry ${action} does not accept --branch, --tag, or --rev`);
              }
            }
            return true;
          }),
      (argv) => {
        const scope = resolveScope(argv.global, argv.local);
        const output = argv.json ? 'json' : 'text';
        const action = String(argv.action);

        const ref =
          typeof argv.branch === 'string'
            ? { refType: 'branch' as const, refValue: argv.branch }
            : typeof argv.tag === 'string'
              ? { refType: 'tag' as const, refValue: argv.tag }
              : typeof argv.rev === 'string'
                ? { refType: 'rev' as const, refValue: argv.rev }
                : undefined;

        switch (action) {
          case 'add':
            sink.set(
              this.factory.createRegistry('add', {
                cwd: process.cwd(),
                scope,
                output,
                name: typeof argv.name === 'string' ? argv.name : undefined,
                url: typeof argv.url === 'string' ? argv.url : undefined,
                refType: ref?.refType,
                refValue: ref?.refValue,
              }),
            );
            return;
          case 'remove':
            sink.set(
              this.factory.createRegistry('remove', {
                cwd: process.cwd(),
                scope,
                output,
                name: typeof argv.name === 'string' ? argv.name : undefined,
              }),
            );
            return;
          case 'list':
            sink.set(
              this.factory.createRegistry('list', {
                cwd: process.cwd(),
                scope,
                output,
              }),
            );
            return;
          case 'use':
            sink.set(
              this.factory.createRegistry('use', {
                cwd: process.cwd(),
                scope,
                output,
                name: typeof argv.name === 'string' ? argv.name : undefined,
              }),
            );
            return;
          case 'auth':
            sink.set(
              this.factory.createRegistry('auth', {
                cwd: process.cwd(),
                output,
                name: typeof argv.name === 'string' ? argv.name : undefined,
              }),
            );
            return;
          case 'refresh':
            sink.set(
              this.factory.createRegistry('refresh', {
                cwd: process.cwd(),
                output,
                name: typeof argv.name === 'string' ? argv.name : undefined,
              }),
            );
            return;
          default:
            throw new Error(`[uapkg] Unsupported registry action: ${action}`);
        }
      },
    );
  }
}
