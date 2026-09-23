import type { Argv } from 'yargs';
import { createUAPKGCommandLineFactory } from '../../UAPKGCommandLine.ts';
import type { CommandLineSink, UAPKGCommandModule } from '../contracts/UAPKGCommandModule.ts';

export class ListCommandModule implements UAPKGCommandModule {
  private readonly factory = createUAPKGCommandLineFactory();

  register(parser: Argv, sink: CommandLineSink): Argv {
    return parser.command(
      'list',
      'Show installed packages from the lockfile',
      (builder) =>
        builder
          .option('depth', {
            type: 'number',
            default: 0,
            describe: '0: declared dependencies only; greater than 0: include all transitive dependencies',
          })
          .option('json', { type: 'boolean', default: false, describe: 'Emit JSON on stdout' }),
      (argv) => {
        sink.set(
          this.factory.createList({
            cwd: process.cwd(),
            depth: typeof argv.depth === 'number' ? argv.depth : 0,
            outputFormat: argv.json ? 'json' : 'text',
          }),
        );
      },
    );
  }
}
