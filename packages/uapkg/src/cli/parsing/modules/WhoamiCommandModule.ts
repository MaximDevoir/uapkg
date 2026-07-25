import type { Argv } from 'yargs';
import { createUAPKGCommandLineFactory } from '../../UAPKGCommandLine.js';
import type { CommandLineSink, UAPKGCommandModule } from '../contracts/UAPKGCommandModule.js';

export class WhoamiCommandModule implements UAPKGCommandModule {
  private readonly factory = createUAPKGCommandLineFactory();

  register(parser: Argv, sink: CommandLineSink): Argv {
    return parser.command(
      'whoami',
      'Show the account associated with this registry login',
      (builder) =>
        builder
          .option('registry', {
            type: 'string',
            describe: 'Configured registry alias (defaults to the selected registry)',
          })
          .option('json', {
            type: 'boolean',
            default: false,
            describe: 'Emit JSON on stdout',
          }),
      (argv) => {
        sink.set(
          this.factory.createWhoami({
            cwd: process.cwd(),
            registry: typeof argv.registry === 'string' ? argv.registry : undefined,
            outputFormat: argv.json ? 'json' : 'text',
          }),
        );
      },
    );
  }
}
