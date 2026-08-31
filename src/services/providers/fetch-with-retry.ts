export interface FetchRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  random?: () => number;
}

const RETRYABLE_STATUSES = new Set([502, 503, 504]);

export async function fetchWithRetry(
  request: () => Promise<Response>,
  options: FetchRetryOptions = {},
): Promise<Response> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 250);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 2_000);
  const sleep = options.sleep ?? ((delayMs) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const random = options.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await request();
      if (!RETRYABLE_STATUSES.has(response.status) || attempt === maxAttempts) return response;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) throw error;
    }

    const exponential = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
    const jitter = Math.floor(exponential * 0.25 * random());
    await sleep(exponential + jitter);
  }

  throw lastError instanceof Error ? lastError : new Error("PROVIDER_RETRY_EXHAUSTED");
}
