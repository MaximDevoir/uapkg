import type { Result } from '@uapkg/diagnostics';
import { partialConfigSchema } from '../configSchema.ts';
import { ConfigCliValueParser } from './ConfigCliValueParser.ts';
import { ConfigSchemaRuntime } from './ConfigSchemaRuntime.ts';

const runtime = new ConfigSchemaRuntime(partialConfigSchema);
const cliValueParser = new ConfigCliValueParser(runtime);

export function getConfigSchemaRuntime(): ConfigSchemaRuntime {
  return runtime;
}

export function parseConfigCliValue(pathToProperty: string, rawValue: string): Result<unknown> {
  return cliValueParser.parse(pathToProperty, rawValue);
}
