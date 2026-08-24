import type { ConfigCreateOptions } from '../contracts/ConfigTypes.ts';
import { ConfigInstance } from '../core/ConfigInstance.ts';

export function createConfig(options: ConfigCreateOptions = {}) {
  return new ConfigInstance(options);
}
