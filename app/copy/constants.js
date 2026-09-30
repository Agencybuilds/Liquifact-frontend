export const cache = new Map();
export const inflight = new Map();

/**
 * Hardened concurrent executor for fetching remote or dynamic constants.
 * Prevents race conditions, duplicate work, and inconsistent state.
 *
 * @param {string} key - Unique identifier for the operation.
 * @param {Function} fetchFn - Async function returning the constant.
 * @param {Object} options - Configuration for execution.
 * @returns {Promise<any>}
 */
export async function executeConcurrentSafe(key, fetchFn, options = {}) {
  if (typeof key !== 'string' || !key.trim()) {
    throw new Error('executeConcurrentSafe: valid key is required');
  }

  const {
    retries = 3,
    timeoutMs = 5000,
    forceRefresh = false
  } = options;

  if (!forceRefresh && cache.has(key)) {
    return cache.get(key);
  }

  if (inflight.has(key)) {
    return inflight.get(key);
  }

  const execute = async () => {
    try {
      let attempt = 0;
      let lastError;
      while (attempt <= retries) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
          const result = await Promise.race([
            fetchFn(),
            new Promise((_, reject) => {
              controller.signal.addEventListener('abort', () => reject(new Error('Timeout')));
            })
          ]);
          clearTimeout(timeoutId);

          // Enforce invariants: freeze result to prevent unsafe mutation
          const safeResult = (typeof result === 'object' && result !== null)
            ? Object.freeze(JSON.parse(JSON.stringify(result)))
            : result;

          cache.set(key, safeResult);
          return safeResult;
        } catch (error) {
          clearTimeout(timeoutId);
          lastError = error;
          attempt++;
          if (attempt <= retries) {
            // Small backoff
            await new Promise(r => setTimeout(r, 10 * attempt));
          }
        }
      }

      // Log without exposing sensitive data
      console.error(`[Constants] Execution failed for key: ${key}`);
      throw new Error(`Concurrent execution failed: ${lastError.message}`);
    } finally {
      inflight.delete(key);
    }
  };

  const promise = execute();
  inflight.set(key, promise);
  return promise;
}

export function clearCache(key) {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}
