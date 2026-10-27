import { ControlPlaneError } from '#cli/control-plane/ControlPlaneTypes.ts';
import { retryBackoff } from '#cli/control-plane/RetryAfter.ts';

/** One cancellable read-only watch. Submissions must never run through this retry boundary. */
export class RequestWatch {
  private readonly cancellation = new AbortController();
  private readonly cancel = () => this.cancellation.abort(new Error('Request watch interrupted.'));

  public constructor(
    private readonly deadline = Number.POSITIVE_INFINITY,
    private readonly timeoutMessage = 'Timed out waiting for the publishing request.',
  ) {
    process.once('SIGINT', this.cancel);
    process.once('SIGTERM', this.cancel);
  }

  public dispose(): void {
    process.removeListener('SIGINT', this.cancel);
    process.removeListener('SIGTERM', this.cancel);
    this.cancellation.abort();
  }

  public async wait(milliseconds = 2_000): Promise<void> {
    const notBefore = Date.now() + milliseconds;
    do {
      this.check();
      const remaining = Math.min(notBefore, this.deadline) - Date.now();
      await new Promise<void>((resolve, reject) => {
        const signal = this.cancellation.signal;
        const abort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(
          () => {
            signal.removeEventListener('abort', abort);
            resolve();
          },
          Math.min(2_147_483_647, Math.max(0, remaining)),
        );
        signal.addEventListener('abort', abort, { once: true });
      });
      this.check();
    } while (Date.now() < notBefore);
  }

  public async read<T>(read: (signal: AbortSignal) => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      this.check();
      const remaining = this.deadline - Date.now();
      const signal = Number.isFinite(remaining)
        ? AbortSignal.any([this.cancellation.signal, AbortSignal.timeout(Math.max(1, Math.ceil(remaining)))])
        : this.cancellation.signal;
      try {
        const value = await read(signal);
        this.check();
        return value;
      } catch (error) {
        this.check();
        if (!(error instanceof ControlPlaneError) || (error.status !== 429 && error.status !== 503)) throw error;
        await this.wait(error.retryAfterMs ?? retryBackoff(attempt));
      }
    }
  }

  private check(): void {
    this.cancellation.signal.throwIfAborted();
    if (Date.now() >= this.deadline) throw new Error(this.timeoutMessage);
  }
}
