import type { ConfigLayer, ConfigResolvedResult } from '#config/contracts/ConfigTypes.ts';
import { partialConfigSchema } from '#config/schema/configSchema.ts';
import { ConfigSchemaMergeEngine } from '#config/merge/ConfigSchemaMergeEngine.ts';

export class ConfigMerger {
  public constructor(private readonly engine = new ConfigSchemaMergeEngine(partialConfigSchema)) {}

  public mergeLayers(layers: readonly ConfigLayer[]): ConfigResolvedResult {
    return this.engine.mergeLayers(layers);
  }
}
