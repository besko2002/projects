/**
 * Bounded polling for the asynchronous half of the saga. The storefront never invents progress:
 * it asks the order API on a backoff schedule and stops at the first decisive answer, after a
 * bounded number of attempts, or when the page unmounts (`signal.cancelled`).
 */

export interface PollResult<T> {
  status: 'value' | 'timeout' | 'cancelled';
  /** The last successful response, when one arrived. */
  value?: T;
}

export interface PollOptions<T> {
  load: () => Promise<T>;
  /** Whether the response is decisive, i.e. polling can stop. */
  isDone: (value: T) => boolean;
  /** Total attempts including the first; defaults to 12. */
  attempts?: number;
  /** Delay before the second attempt; doubles per attempt up to maxDelayMs. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Set `cancelled` on unmount so the loop stops and its timers are abandoned. */
  signal?: { cancelled: boolean };
  /** Called with every successful response, e.g. to update the screen while waiting. */
  onValue?: (value: T) => void;
  /**
   * Errors for which another attempt may succeed (network, 429, 5xx). Any other error aborts
   * the poll and is rethrown so the caller can show the real reason (e.g. 404, 401).
   */
  retryable?: (error: unknown) => boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function pollUntil<T>(options: PollOptions<T>): Promise<PollResult<T>> {
  const attempts = Math.max(1, options.attempts ?? 12);
  const baseDelayMs = Math.max(0, options.baseDelayMs ?? 1200);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 6000);
  let delay = baseDelayMs;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.signal?.cancelled) {
      return { status: 'cancelled' };
    }

    let value: T;
    try {
      value = await options.load();
    } catch (error) {
      if (options.signal?.cancelled) {
        return { status: 'cancelled' };
      }
      if (!options.retryable || !options.retryable(error) || attempt === attempts - 1) {
        throw error;
      }
      await sleep(delay);
      delay = Math.min(delay * 2, maxDelayMs);
      continue;
    }

    if (options.signal?.cancelled) {
      return { status: 'cancelled' };
    }
    options.onValue?.(value);
    if (options.isDone(value)) {
      return { status: 'value', value };
    }
    if (attempt === attempts - 1) {
      return { status: 'timeout', value };
    }
    await sleep(delay);
    delay = Math.min(delay * 2, maxDelayMs);
  }

  return { status: 'timeout' };
}
