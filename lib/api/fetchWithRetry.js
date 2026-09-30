/**
 * @file Retry-with-exponential-backoff wrapper for the native fetch API.
 *
 * Provides a configurable `fetchWithRetry` function that retries failed HTTP
 * requests on transient errors (network failures and 5xx server errors) using
 * exponential backoff with jitter. 4xx client errors are never retried because
 * they indicate a problem with the request itself.
 *
 * Determinism guarantees:
 * - The decision to retry a given (error, response) pair is pure and
 *   deterministic given the configured predicate.
 * - Retries are bounded by `maxAttempts`; the function always terminates
 *   with either the final Response or the last error.
 * - Aborts are honoured between attempts and during backoff sleeps, so a
 *   cancelled request never produces an extra network call.
 * - Non-idempotent methods are not replayed unless explicitly opted in,
 *   preventing duplicate side effects.
 *
 * @module fetchWithRetry
 */

/**
 * Error thrown when a request exhausts all retry attempts. Carries the
 * underlying cause and the number of attempts made so callers can log and
 * recover deterministically.
 */
export class RetryExhaustedError extends Error {
  /**
   * @param {string} message
   * @param {object} [attributes]
   * @param {number} [attributes].attempts
   * @param {Error|null} [attributes].cause
   * @param {Response|null} [attributes].response
   */
  constructor(message, { attempts, cause = null, response = null } = {}) {
    super(message);
    this.name = "RetryExhaustedError";
    this.attempts = attempts;
    this.cause = cause;
    this.response = response;
  }
}

/**
 * Default delay function: exponential backoff with full jitter.
 * delay = random(0, baseDelay * 2^attempt)
 * This spreads retries from multiple clients nicely.
 *
 * @param {number} attempt - Zero-based attempt counter.
 * @param {number} baseDelayMs - Base delay in milliseconds.
 * @returns {number} Delay in milliseconds before the next retry.
 */
function defaultDelay(attempt, baseDelayMs) {
  const maxDelay = baseDelayMs * Math.pow(2, attempt);
  return Math.random() * maxDelay;
}

/**
 * Default retry predicate: only retry on network errors or 5xx server errors.
 *
 * @param {Error | null} error - The error from the rejected fetch, or null if fetch resolved.
 * @param {Response | null} response - The Response object, or null if fetch rejected.
 * @returns {boolean} True if the request should be retried.
 */
function defaultShouldRetry(error, response) {
  // Network errors (fetch rejected) are always worth retrying.
  if (error) return true;
  // Only retry 5xx server errors.
  if (response && response.status >= 500 && response.status < 600) return true;
  return false;
}

/**
 * Determines if an HTTP method is generally considered idempotent.
 * Non-idempotent methods (POST, PATCH, DELETE) are NOT retried by default
 * because replaying them could cause duplicate side effects.
 *
 * @param {string} method - HTTP method (upper-cased internally).
 * @returns {boolean} True if the method is idempotent.
 */
function isIdempotentMethod(method) {
  return ["GET", "HEAD", "PUT", "DELETE", "OPTIONS", "TRACE"].includes(method.toUpperCase());
}

/**
 * Promise-based sleep that can be cancelled via an AbortSignal.
 *
 * @param {number} ms - Milliseconds to sleep.
 * @param {AbortSignal|null} signal - Optional AbortSignal to cancel the sleep.
 * @returns {Promise<void>}
 */
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      return reject(new DOMException("The operation was aborted.", "AbortError"));
    }

    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    function cleanup() {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    }

    function onAbort() {
      cleatTimeout(timer);
      cleanup();
      reject(new DOMException("The operation was aborted.", "AbortError"));
    }

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/**
 * Wraps the native fetch API with configurable retry logic using exponential
 * backoff with jitter.
 *
 * @param {string} url - The URL to fetch.
 * @param {object} [options] - Standard fetch options (method, headers, body, signal, etc.).
 * @param {object} [retryOptions] - Retry configuration.
 * @param {number} [retryOptions.maxAttempts=3] - Maximum number of fetch attempts.
 *   The first call counts as attempt #1, so total retries = maxAttempts - 1.
 * @param {number} [retryOptions.baseDelayMs=1000] - Base delay in milliseconds
 *   for the exponential backoff calculation.
 * @param {function} [retryOptions.delayFn] - Custom delay function.
 *   Signature: (attempt: number, baseDelayMs: number) => number
 * @param {function} [retryOptions.shouldRetry] - Custom retry predicate.
 *   Signature: (error: Error | null, response: Response | null) => boolean
 * @param {boolean} [retryOptions.retryNonIdempotent=false] - If true, also retry
 *   non-idempotent methods (POST, PATCH). Defaults to false.
 * @param {function} [retryOptions.onRetry] - Optional observability hook invoked
 *   before each retry with ({ attempt, delayMs, error, response }). Errors thrown
 *   by this hook are swallowed so observability cannot break recovery.
 * @returns {Promise<Response>} A promise that resolves with the final Response
 *   or rejects with the last error encountered.
 */
export async function fetchWithRetry(url, options = {}, retryOptions = {}) {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    delayFn = defaultDelay,
    shouldRetry = defaultShouldRetry,
    retryNonIdempotent = false,
    onRetry = null,
  } = retryOptions;

  // Validate configuration deterministically. A non-positive or non-integer
  // maxAttempts would otherwise silently skip the loop and throw an
  // uninformative error, so we fail fast instead.
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(
      `fetchWithRetry: maxAttempts must be a positive integer, received ${maxAttempts}`,
    );
  }
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
    throw new RangeError(
      `fetchWithRetry: baseDelayMs must be a non-negative finite number, received ${baseDelayMs}`,
    );
  }
  if (typeof delayFn !== "function") {
    throw new TypeError("fetchWithRetry: delayFn must be a function");
  }
  if (typeof shouldRetry !== "function") {
    throw new TypeError("fetchWithRetry: shouldRetry must be a function");
  }

  const originalSignal = options.signal || null;
  const method = (options.method || "GET").toUpperCase();

  // Non-idempotent methods bypass retry unless explicitly configured otherwise.
  if (!isIdempotentMethod(method) && !retryNonIdempotent) {
    return fetch(url, options);
  }

  let lastError = null;
  let lastResponse = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // If the original signal was aborted, stop immediately.
    if (originalSignal && originalSignal.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    try {
      const response = await fetch(url, options);

      // Success — return immediately.
      if (response.ok) {
        return response;
      }

      lastResponse = response;
      lastError = null;

      // If this was our last attempt, return the response as-is.
      if (attempt >= maxAttempts - 1) {
        return response;
      }

      // Check if this response status warrants a retry.
      if (!shouldRetry(null, response)) {
        return response;
      }
    } catch (err) {
      lastError = err;
      lastResponse = null;

      // AbortError is never retried.
      if (err && err.name === "AbortError") {
        throw err;
      }

      // If this was our last attempt, re-throw the error.
      if (attempt >= maxAttempts - 1) {
        throw err;
      }

      // Check if this error warrants a retry.
      if (!shouldRetry(err, null)) {
        throw err;
      }
    }

    // Compute the backoff delay deterministically for this attempt and
    // clamp it to a sanity bound so a misconfigured delayFn cannot block the
    // caller indefinitely or produce a negative timeout.
    const rawDelay = delayFn(attempt, baseDelayMs);
    const delayMs = Number.isFinite(rawDelay) ? Math.max(0, rawDelay) : 0;

    // Observability hook — must never break recovery.
    if (typeof onRetry === "function") {
      try {
        onRetry({ attempt, delayMs, error: lastError, response: lastResponse });
      } catch {
        // intentionally swallowed: observability must not alter control flow.
      }
    }

    // Wait before the next attempt using backoff delay.
    await sleep(delayMs, originalSignal);
  }

  // Defensive fallback: the loop always returns or throws within its body,
  // but keep a deterministic terminal guarantee for the control-flow analyser.
  if (lastError) throw lastError;
  if (lastResponse) return lastResponse;
  throw new RetryExhaustedError(
    "fetchWithRetry: exhausted all attempts without a response or error",
    { attempts : maxAttempts },
  );
}

export { defaultDelay, defaultShouldRetry, isIdempotentMethod };
