import type { Argv } from 'yargs';
import { createUAPKGCommandLineFactory } from '../../UAPKGCommandLine.ts';
import type { CommandLineSink, UAPKGCommandModule } from '../contracts/UAPKGCommandModule.ts';

export class UpdateCommandModule implements UAPKGCommandModule {
  private readonly factory = createUAPKGCommandLineFactory();

  register(parser: Argv, sink: CommandLineSink) {
    return parser.command(
      'update [specs..]',
      'Update dependencies and the lockfile',
      (builder) =>
        builder
          .positional('specs', { type: 'string', array: true, describe: 'Package names with optional version ranges' })
          .option('force', {
            type: 'boolean',
            default: false,
            describe: 'Override safety policies for local drift/branch divergence',
          })
          .option('dry-run', {
            type: 'boolean',
            default: false,
            describe: 'Preview installation; the manifest, lockfile, and registry cache may still change',
          })
          .option('json', { type: 'boolean', default: false, describe: 'Emit JSON on stdout' }),
      (argv) => {
        const specsArg = argv.specs;
        const specs = Array.isArray(specsArg) ? (specsArg.filter((v) => typeof v === 'string') as string[]) : [];
        sink.set(
          this.factory.createUpdate({
            cwd: process.cwd(),
            specs,
            force: argv.force,
            dryRun: argv['dry-run'],
            outputFormat: argv.json ? 'json' : 'text',
          }),
        );
      },
    );
  }
}
