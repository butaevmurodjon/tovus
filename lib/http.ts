/**
 * fetch with a hard timeout via AbortController. The timer is always cleared
 * — success, an HTTP error status, a network failure, or the abort itself —
 * via `finally`, so a request that fails for a reason OTHER than the timeout
 * never leaves a stale timer running until it fires on its own (§3 audit
 * finding: both deepseek.ts and cas.ts used to clear the timer only on the
 * successful branch).
 */
export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
