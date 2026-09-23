import type { ConfigCreateOptions } from '#config/contracts/ConfigTypes.ts';
import { ConfigInstance } from '#config/core/ConfigInstance.ts';

export function createConfig(options: ConfigCreateOptions = {}) {
  return new ConfigInstance(options);
}
