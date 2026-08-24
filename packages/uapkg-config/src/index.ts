import { ConfigInstance } from './core/ConfigInstance.ts';
import { createConfig } from './factory/createConfig.ts';

const singleton = new ConfigInstance({ cwd: process.cwd() });

const Config = {
  get(pathToProperty?: string, options?: { scope?: 'global' | 'local' }) {
    return singleton.get(pathToProperty, options);
  },
  getAll(options?: { scope?: 'global' | 'local' }) {
    return singleton.getAll(options);
  },
  getDefaultRegistry() {
    return singleton.getDefaultRegistry();
  },
  getWithOrigin(pathToProperty: string) {
    return singleton.getWithOrigin(pathToProperty);
  },
  trace(pathToProperty: string) {
    return singleton.trace(pathToProperty);
  },
  getDiagnostics() {
    return singleton.getDiagnostics();
  },
  reload(options?: { cwd?: string }) {
    singleton.reload(options);
    return Config;
  },
};

export default Config;
export type {
  ConfigCreateOptions,
  ConfigTraceEntry,
  ConfigValueWithOrigin,
  PostInstallPolicyValue,
  RegistryConfig,
  RegistryRef,
  ResolvedConfig,
} from './contracts/ConfigTypes.ts';
export { PostInstallPolicyResolver } from './core/PostInstallPolicyResolver.ts';
export { getConfigSchemaAtPath, isLeafConfigPath, isValidConfigPath, validateConfigPath } from './schema/pathSchema.ts';
export { parseConfigCliValue } from './schema/runtime/ConfigSchemaRuntimeProvider.ts';
export { ConfigInstance, createConfig };
