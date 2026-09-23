import type { Argv } from 'yargs';
import { createUAPKGCommandLineFactory } from '../../UAPKGCommandLine.ts';
import type { CommandLineSink, UAPKGCommandModule } from '../contracts/UAPKGCommandModule.ts';

export class InitCommandModule implements UAPKGCommandModule {
  private readonly factory = createUAPKGCommandLineFactory();

  register(parser: Argv, sink: CommandLineSink) {
    return parser.command(
      'init',
      'Initialize uapkg.json',
      (builder) =>
        builder
          .option('type', {
            type: 'string',
            choices: ['project', 'plugin'] as const,
            describe: 'Manifest type',
          })
          .option('name', {
            type: 'string',
            describe: 'Package name',
          }),
      (argv) => {
        sink.set(
          this.factory.createInit({
            cwd: process.cwd(),
            type: argv.type,
            name: typeof argv.name === 'string' ? argv.name : undefined,
          }),
        );
      },
    );
  }
}
