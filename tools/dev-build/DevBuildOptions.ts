import type { CliBuildMode, DevBuildMode, DevBuildOptions } from './types';

const BUILD_MODE_FLAGS = new Set(['--development', '--production']);

export function parseDevBuildOptions(command: DevBuildMode, args: string[]): DevBuildOptions {
  const hasDevelopment = args.includes('--development');
  const hasProduction = args.includes('--production');

  if (hasDevelopment && hasProduction) {
    throw new Error('[dev-build] --development and --production cannot be used together.');
  }

  if (command !== 'build' && (hasDevelopment || hasProduction)) {
    const commandDescription =
      command === 'link' || command === 'watch'
        ? `${command} always uses a development build`
        : `${command} does not build the CLI`;
    throw new Error(`[dev-build] Build mode flags are not supported by ${command}; ${commandDescription}.`);
  }

  const allowedFlags = getAllowedFlags(command);
  const unsupportedFlag = args.find((arg) => !allowedFlags.has(arg));
  if (unsupportedFlag) {
    throw new Error(`[dev-build] Unsupported option for ${command}: ${unsupportedFlag}`);
  }

  return {
    force: args.includes('--force'),
    buildMode: command === 'build' ? resolveBuildMode(hasDevelopment) : undefined,
  };
}

function getAllowedFlags(command: DevBuildMode) {
  if (command === 'build') {
    return BUILD_MODE_FLAGS;
  }

  if (command === 'link' || command === 'unlink') {
    return new Set(['--force']);
  }

  return new Set<string>();
}

function resolveBuildMode(hasDevelopment: boolean): CliBuildMode {
  return hasDevelopment ? 'development' : 'production';
}
