import type { Argv } from 'yargs';
import { createUAPKGCommandLineFactory } from '#cli/cli/UAPKGCommandLine.ts';
import type { CommandLineSink, UAPKGCommandModule } from '#cli/cli/parsing/contracts/UAPKGCommandModule.ts';

export class PackCommandModule implements UAPKGCommandModule {
  private readonly factory = createUAPKGCommandLineFactory();

  register(parser: Argv, sink: CommandLineSink) {
    return parser.command(
      'pack',
      'Create a .tgz package archive and integrity file',
      (builder) =>
        builder
          .option('dry-run', {
            type: 'boolean',
            default: false,
            describe: 'List the files to include without creating an archive',
          })
          .option('allow-missing-lfs', {
            type: 'boolean',
            default: false,
            describe: 'Allow unresolved Git LFS pointers to be skipped',
          })
          .option('outFile', {
            type: 'string',
            describe: 'Output .tgz file path',
          }),
      (argv) => {
        sink.set(
          this.factory.createPack({
            cwd: process.cwd(),
            dryRun: argv['dry-run'],
            allowMissingLfs: argv['allow-missing-lfs'],
            outFile: typeof argv.outFile === 'string' ? argv.outFile : undefined,
          }),
        );
      },
    );
  }
}
