import type { Argv } from 'yargs';
import { createUAPKGCommandLineFactory } from '../../UAPKGCommandLine.ts';
import type { CommandLineSink, UAPKGCommandModule } from '../contracts/UAPKGCommandModule.ts';

export class LogoutCommandModule implements UAPKGCommandModule {
  private readonly factory = createUAPKGCommandLineFactory();

  register(parser: Argv, sink: CommandLineSink): Argv {
    return parser.command(
      'logout',
      'Revoke and remove the saved login for one registry',
      (builder) =>
        builder
          .option('registry', {
            type: 'string',
            describe: 'Configured registry alias (defaults to the selected registry)',
          })
          .option('local-only', {
            type: 'boolean',
            default: false,
            describe: 'Remove local credentials without revoking the remote grant',
          })
          .option('json', {
            type: 'boolean',
            default: false,
            describe: 'Emit JSON on stdout',
          }),
      (argv) => {
        sink.set(
          this.factory.createLogout({
            cwd: process.cwd(),
            registry: typeof argv.registry === 'string' ? argv.registry : undefined,
            localOnly: argv['local-only'] === true,
            outputFormat: argv.json ? 'json' : 'text',
          }),
        );
      },
    );
  }
}
