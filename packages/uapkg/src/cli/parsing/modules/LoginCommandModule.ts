import type { Argv } from 'yargs';
import { createUAPKGCommandLineFactory } from '../../UAPKGCommandLine.js';
import type { CommandLineSink, UAPKGCommandModule } from '../contracts/UAPKGCommandModule.js';

export class LoginCommandModule implements UAPKGCommandModule {
  private readonly factory = createUAPKGCommandLineFactory();

  register(parser: Argv, sink: CommandLineSink): Argv {
    return parser.command(
      'login',
      'Authorize this browser-capable workstation for one registry',
      (builder) =>
        builder
          .option('registry', {
            type: 'string',
            describe: 'Configured registry alias (defaults to the selected registry)',
          })
          .option('device-name', {
            type: 'string',
            describe: 'Device label shown on the authorization page',
          })
          .option('reauthorize', {
            type: 'boolean',
            default: false,
            describe: 'Replace the saved grant for this registry',
          })
          .option('json', {
            type: 'boolean',
            default: false,
            describe: 'Emit JSON on stdout',
          }),
      (argv) => {
        sink.set(
          this.factory.createLogin({
            cwd: process.cwd(),
            registry: typeof argv.registry === 'string' ? argv.registry : undefined,
            deviceName: typeof argv['device-name'] === 'string' ? argv['device-name'] : undefined,
            reauthorize: argv.reauthorize === true,
            outputFormat: argv.json ? 'json' : 'text',
          }),
        );
      },
    );
  }
}
