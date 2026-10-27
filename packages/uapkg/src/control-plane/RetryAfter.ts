/** A valid server delay is a minimum, including an HTTP-date already in the past. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    const milliseconds = Number(trimmed) * 1_000;
    return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
  }
  if (!/[A-Za-z]/.test(trimmed)) return undefined;
  const date = Date.parse(trimmed);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

export function retryBackoff(attempt: number, maximumMs = 30_000): number {
  const base = Math.min(maximumMs, 1_000 * 2 ** Math.min(attempt - 1, 20));
  return Math.min(maximumMs, Math.ceil(base * (1 + Math.random() * 0.25)));
}
