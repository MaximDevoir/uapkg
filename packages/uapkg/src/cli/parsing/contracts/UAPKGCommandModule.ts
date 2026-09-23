import type { Argv } from 'yargs';
import type { UAPKGCommandLine } from '#cli/cli/UAPKGCommandLine.ts';

export interface CommandLineSink {
  set(commandLine: UAPKGCommandLine): void;
}

export interface UAPKGCommandModule {
  register(parser: Argv, sink: CommandLineSink): Argv;
}
