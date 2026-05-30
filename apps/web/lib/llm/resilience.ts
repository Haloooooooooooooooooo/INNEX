type RetryOptions = {
  attempts?: number;
  timeoutMs?: number;
  retryDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
};

const DEFAULTS: Required<RetryOptions> = {
  attempts: 2,
  timeoutMs: 25000,
  retryDelayMs: 500,
  shouldRetry: () => true,
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    fn(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout_after_${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const cfg = { ...DEFAULTS, ...(options || {}) };
  let lastError: unknown = null;

  for (let i = 0; i < cfg.attempts; i++) {
    try {
      return await withTimeout(fn, cfg.timeoutMs);
    } catch (err) {
      lastError = err;
      const canRetry = i < cfg.attempts - 1 && cfg.shouldRetry(err);
      if (!canRetry) break;
      await sleep(cfg.retryDelayMs * (i + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("retry_failed");
}

/**
 * Runs `fn` over `items` with a bounded number of in-flight tasks.
 * - Preserves input order in the result array (result[i] maps to items[i]).
 * - A task that throws resolves to `null` for that slot (it does not reject the whole batch).
 * - `limit` is clamped to [1, items.length]; limit<=1 degrades to sequential.
 */
export async function mapWithConcurrency<TIn, TOut>(
  items: TIn[],
  limit: number,
  fn: (item: TIn, index: number) => Promise<TOut>
): Promise<Array<TOut | null>> {
  const results: Array<TOut | null> = new Array(items.length).fill(null);
  if (!items.length) return results;
  const bounded = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index], index);
      } catch {
        results[index] = null;
      }
    }
  }

  await Promise.all(Array.from({ length: bounded }, () => worker()));
  return results;
}

