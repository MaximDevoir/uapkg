import type { LoggerOptions, LoggerStateResolver } from '#log/contracts/LoggerTypes.ts';
import { LoggerInstance } from '#log/core/LoggerInstance.ts';
import { LogLevelPolicy } from '#log/core/LogLevelPolicy.ts';
import { WinstonLoggerAdapter } from '#log/core/WinstonLoggerAdapter.ts';

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
