import type { ConfigLayer, ConfigResolvedResult } from '../contracts/ConfigTypes.ts';
import { partialConfigSchema } from '../schema/configSchema.ts';
import { ConfigSchemaMergeEngine } from './ConfigSchemaMergeEngine.ts';

export class ConfigMerger {
  public constructor(private readonly engine = new ConfigSchemaMergeEngine(partialConfigSchema)) {}

  public mergeLayers(layers: readonly ConfigLayer[]): ConfigResolvedResult {
    return this.engine.mergeLayers(layers);
  }
}
