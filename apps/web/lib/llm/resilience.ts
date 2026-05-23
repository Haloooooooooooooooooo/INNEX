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

