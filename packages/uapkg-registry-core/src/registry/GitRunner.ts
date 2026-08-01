import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process';
import { createGitErrorDiagnostic, ok, type Result } from '@uapkg/diagnostics';
import { redactRegistryUrlSecrets, sanitizeRegistryUrlForDisplay } from './RegistryUrlSanitizer.js';

export type GitInteractionMode = 'non-interactive' | 'interactive';

export interface GitRunOptions {
  readonly cwd?: string;
  readonly interaction?: GitInteractionMode;
  readonly timeoutMs?: number;
}

export interface GitCommandRunner {
  run(args: readonly string[], options?: GitRunOptions): Promise<Result<void>>;
}

export type GitProcessSpawner = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Runs the configured system Git without ever handling Git credentials itself.
 *
 * Normal registry operations are deliberately non-interactive. An explicitly
 * interactive access probe may hand stdin and stderr to Git so its configured
 * credential helper or SSH agent can authenticate the user.
 */
export class GitRunner implements GitCommandRunner {
  public constructor(
    private readonly gitBinary: string,
    private readonly sensitiveValues: readonly string[] = [],
    private readonly spawnProcess: GitProcessSpawner = spawn,
  ) {}

  public async run(args: readonly string[], options: GitRunOptions = {}): Promise<Result<void>> {
    const interaction = options.interaction ?? 'non-interactive';
    const interactive = interaction === 'interactive';
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const spawnOptions: SpawnOptions = {
      cwd: options.cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: interactive ? '1' : '0',
        GCM_INTERACTIVE: interactive ? '1' : '0',
      },
      stdio: interactive ? ['inherit', 'ignore', 'inherit'] : ['ignore', 'pipe', 'pipe'],
      windowsHide: !interactive,
    };

    return await new Promise<Result<void>>((resolve) => {
      let child: ChildProcess;
      try {
        child = this.spawnProcess(this.gitBinary, args, spawnOptions);
      } catch (error) {
        resolve(this.failure(args, String(error), 1));
        return;
      }

      let stderr = '';
      let settled = false;
      let timedOut = false;
      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += String(chunk);
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, timeoutMs);
      timer.unref?.();

      const finish = (result: Result<void>) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };

      child.once('error', (error) => {
        finish(this.failure(args, String(error), 1));
      });
      child.once('close', (code) => {
        if (code === 0 && !timedOut) {
          finish(ok(undefined));
          return;
        }

        const detail = timedOut
          ? `Git command timed out after ${timeoutMs}ms.`
          : interactive
            ? 'Interactive Git authentication did not complete successfully. Git may have printed more detail above.'
            : stderr || 'Git command failed without diagnostic output.';
        finish(this.failure(args, detail, code ?? 1));
      });
    });
  }

  private failure(args: readonly string[], stderr: string, exitCode: number): Result<void> {
    const redactedArgs = args.map((argument) => this.redact(argument, true));
    return {
      ok: false,
      diagnostics: [
        createGitErrorDiagnostic(
          `${this.gitBinary} ${redactedArgs.join(' ')}`,
          this.redact(stderr, false).trim(),
          exitCode,
        ),
      ],
    };
  }

  private redact(value: string, commandArgument: boolean): string {
    let redacted = value;
    for (const sensitive of this.sensitiveValues) {
      if (commandArgument && redacted === sensitive) {
        redacted = sanitizeRegistryUrlForDisplay(sensitive);
      } else {
        redacted = redactRegistryUrlSecrets(redacted, sensitive);
      }
    }
    return redacted;
  }
}
