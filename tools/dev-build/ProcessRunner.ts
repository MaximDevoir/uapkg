import { spawnSync } from 'node:child_process';

interface RunOptions {
  ignoreFailure?: boolean;
  env?: NodeJS.ProcessEnv;
}

export class ProcessRunner {
  run(command: string, args: string[], cwd: string, options: RunOptions = {}) {
    const result = this.spawn(command, args, cwd, 'inherit', options);

    this.throwIfFailed(command, args, result.error, result.status, options.ignoreFailure);
  }

  runAndCapture(command: string, args: string[], cwd: string, options: RunOptions = {}) {
    const result = this.spawn(command, args, cwd, ['ignore', 'pipe', 'pipe'], options);

    this.throwIfFailed(command, args, result.error, result.status, options.ignoreFailure);

    return {
      stdout: typeof result.stdout === 'string' ? result.stdout : (result.stdout?.toString('utf8') ?? ''),
      stderr: typeof result.stderr === 'string' ? result.stderr : (result.stderr?.toString('utf8') ?? ''),
      status: result.status ?? 0,
    };
  }

  private spawn(
    command: string,
    args: string[],
    cwd: string,
    stdio: 'inherit' | ['ignore', 'pipe', 'pipe'],
    options: RunOptions,
  ) {
    const env = {
      ...process.env,
      ...options.env,
    };

    if (process.platform === 'win32' && this.isCmdShim(command)) {
      return spawnSync('cmd.exe', ['/d', '/s', '/c', command, ...args], {
        cwd,
        stdio,
        encoding: stdio === 'inherit' ? undefined : 'utf8',
        shell: false,
        env,
      });
    }

    return spawnSync(command, args, {
      cwd,
      stdio,
      encoding: stdio === 'inherit' ? undefined : 'utf8',
      shell: false,
      env,
    });
  }

  private isCmdShim(command: string): boolean {
    return command === 'vp';
  }

  private throwIfFailed(
    command: string,
    args: string[],
    error: Error | undefined,
    status: number | null,
    ignoreFailure: boolean | undefined,
  ) {
    if (error) {
      throw error;
    }

    if ((status ?? 1) !== 0 && ignoreFailure !== true) {
      throw new Error(`[dev-build] Command failed: ${command} ${args.join(' ')}`);
    }
  }
}
