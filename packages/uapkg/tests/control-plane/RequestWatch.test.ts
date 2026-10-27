import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { ControlPlaneError } from '../../src/control-plane/ControlPlaneTypes.ts';
import { RequestWatch } from '../../src/control-plane/RequestWatch.ts';
import { parseRetryAfter, retryBackoff } from '../../src/control-plane/RetryAfter.ts';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('read-only request watch backoff', () => {
  it('waits for the complete server delay before retrying a throttled read', async () => {
    vi.useFakeTimers();
    const watch = new RequestWatch(Date.now() + 120_000);
    const read = vi
      .fn()
      .mockRejectedValueOnce(
        new ControlPlaneError('RATE_LIMIT_EXCEEDED', 'Wait', 429, undefined, { retryAfterMs: 65_000 }),
      )
      .mockResolvedValue('ready');
    try {
      const result = watch.read(read);
      await vi.advanceTimersByTimeAsync(64_999);
      expect(read).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(result).resolves.toBe('ready');
      expect(read).toHaveBeenCalledTimes(2);
    } finally {
      watch.dispose();
    }
  });

  it('uses exponential jittered fallback for unavailable reads and caps only fallback delays', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const watch = new RequestWatch(Date.now() + 60_000);
    const read = vi
      .fn()
      .mockRejectedValueOnce(new ControlPlaneError('RATE_LIMIT_UNAVAILABLE', 'Wait', 503))
      .mockRejectedValueOnce(new ControlPlaneError('RATE_LIMIT_UNAVAILABLE', 'Wait', 503))
      .mockResolvedValue('ready');
    try {
      const result = watch.read(read);
      await vi.advanceTimersByTimeAsync(1_124);
      expect(read).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(read).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(2_250);
      await expect(result).resolves.toBe('ready');
      expect(retryBackoff(100)).toBe(30_000);
    } finally {
      watch.dispose();
    }
  });

  it('ends at the original deadline without retrying before a longer server minimum', async () => {
    vi.useFakeTimers();
    const watch = new RequestWatch(Date.now() + 5_000, 'Watch deadline reached');
    const read = vi
      .fn()
      .mockRejectedValue(
        new ControlPlaneError('RATE_LIMIT_EXCEEDED', 'Wait', 429, undefined, { retryAfterMs: 60_000 }),
      );
    try {
      const result = expect(watch.read(read)).rejects.toThrow('Watch deadline reached');
      await vi.advanceTimersByTimeAsync(5_000);
      await result;
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      watch.dispose();
    }
  });

  it('cancels an outstanding wait and removes signal handlers', async () => {
    vi.useFakeTimers();
    const listeners = process.listenerCount('SIGINT');
    const watch = new RequestWatch();
    try {
      const result = expect(watch.wait(60_000)).rejects.toThrow('Request watch interrupted');
      process.emit('SIGINT');
      await result;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      watch.dispose();
    }
    expect(process.listenerCount('SIGINT')).toBe(listeners);
  });

  it('does not retry authorization failures', async () => {
    const watch = new RequestWatch();
    const read = vi.fn().mockRejectedValue(new ControlPlaneError('FORBIDDEN', 'Denied', 403));
    try {
      await expect(watch.read(read)).rejects.toMatchObject({ status: 403 });
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      watch.dispose();
    }
  });
});

describe('Retry-After parsing', () => {
  it('supports seconds and HTTP dates without accepting invalid or overflowing delays', () => {
    const now = Date.parse('2026-10-26T00:00:00Z');
    expect(parseRetryAfter('90', now)).toBe(90_000);
    expect(parseRetryAfter('Mon, 26 Oct 2026 00:01:30 GMT', now)).toBe(90_000);
    expect(parseRetryAfter('Sun, 25 Oct 2026 00:00:00 GMT', now)).toBe(0);
    for (const invalid of ['-1', '0.5', '99999999999999999999999', 'invalid'])
      expect(parseRetryAfter(invalid, now)).toBeUndefined();
  });
});
