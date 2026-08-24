import type { LoggerOptions, LoggerStateResolver } from '../contracts/LoggerTypes.ts';
import { LoggerInstance } from './LoggerInstance.ts';
import { LogLevelPolicy } from './LogLevelPolicy.ts';
import { WinstonLoggerAdapter } from './WinstonLoggerAdapter.ts';

export class LoggerFactory {
  constructor(private readonly policy = new LogLevelPolicy()) {}

  create(options: LoggerOptions = {}, resolver?: LoggerStateResolver) {
    const level = this.policy.resolveEffectiveLevel({
      explicitVerbose: options.verbose,
      explicitQuiet: options.quiet,
      resolver,
    });

    return new LoggerInstance(new WinstonLoggerAdapter(), level, options.context);
  }
}
