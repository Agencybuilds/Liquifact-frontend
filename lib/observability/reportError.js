const SENSITIVE_KEYS = new Set(["password", "token", "secret", "authorization", "cookie"]);

const MAX_DEPTH = 6;
const MAX_ARGS = 50;
const MAX_STRING = 2000;

/**
 * Returns true when the given key name looks sensitive.
 * Matching is case-insensitive and also detects common suffixes such as
 * accessToken, refreshToken, apiKey, clientSecret, etc.
 * @param {string} key
 * @returns {boolean}
 */
function isSensitiveKey(key) {
  if (typeof key !== "string") {
    return false;
  }
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (SENSITIVE_KEYS.has(normalized)) {
    return true;
  }
  for (const sensitive of SENSITIVE_KEYS) {
    if (normalized.endsWith(sensitive)) {
      return true;
    }
  }
  return false;
}

/**
 * Scrubs a value for safe logging. Handles circular references, deeply
 * nested objects, Error instances, and oversized strings.
 * @param {*} value
 * @param {WeakSet} seen
 * @param {number} depth
 * @returns {*}
 */
function scrubValue(value, seen, depth) {
  if (value === null || value === undefined) {
    return value;
  }

  const type = typeof value;

  if (type === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...[truncated]` : value;
  }

  if (type === "number" || type === "boolean" || type === "bigint") {
    return value;
  }

  if (type === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }

  if (type === "symbol") {
    return value.toString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      digest: value.digest,
    };
  }

  if (depth >= MAX_DEPTH) {
    return "[MaxDepth]";
  }

  if (seen.has(value)) {
    return "[Circular]";
  }

  if (Array.isArray(value)) {
    seen.add(value);
    const limited = value.slice(0, MAX_ARGS).map((item) => scrubValue(item, seen, depth + 1));
    if (value.length > MAX_ARGS) {
      limited.push(`[+${value.length - MAX_ARGS} more]`);
    }
    seen.delete(value);
    return limited;
  }

  if (type === "object") {
    seen.add(value);
    const out = {};
    const keys = Object.keys(value);
    for (let i = 0; i < keys.length && i < MAX_ARGS; i++) {
      const key = keys[i];
      if (isSensitiveKey(key)) {
        out[key] = "[REDACTED]";
      } else {
        try {
          out[key] = scrubValue(value[key], seen, depth + 1);
        } catch {
          out[key] = "[Unreadable]";
        }
      }
    }
    if (keys.length > MAX_ARGS) {
      out.__truncated__ = `+${keys.length - MAX_ARGS} more keys`;
    }
    seen.delete(value);
    return out;
  }

  return String(value);
}

/**
 * Public helper that scrubs an arbitrary context object for safe logging.
 * Exported so callers and tests can reuse the exact same sanitization.
 * @param {*} context
 * @returns {*}
 */
export const scrubContext = (context) => {
  if (context === null || context === undefined) {
    return context;
  }
  try {
    return scrubValue(context, new WeakSet(), 0);
  } catch {
    return "[UnableToScrub]";
  }
};

/**
 * Default logging sink. Wraps console.error and scrubs sensitive PII/secrets.
 * Never throws: any failure in scrubbing falls back to a safe string.
 */
const defaultSink = (error, context) => {
  const safeContext = scrubContext(context);
  console.error("[ErrorReporter]", error, safeContext);
};

let currentReporter = defaultSink;

/**
 * Overrides the default error logging sink.
 * Useful for injecting telemetry adapters (e.g., Sentry, Datadog).
 * @param {Function} reporterFn
 */
export const setReporter = (reporterFn) => {
  if (typeof reporterFn !== "function") {
    throw new Error("Reporter must be a function");
  }
  currentReporter = reporterFn;
};

/**
 * Resets the reporter to the default console sink.
 * Mainly used for test isolation.
 */
export const resetReporter = () => {
  currentReporter = defaultSink;
};

let isReporting = false;

/**
 * Primary error boundary logging interface.
 *
 * Invariants:
 *   - Never throws, regardless of the injected reporter.
 *   - Always invokes the current reporter exactly once per call.
 *   - Failures in the reporter are observable via a fallsafe console log.
 *   - Sensitive context keys are redacted before being handed to the sink.
 *   - Re-entrant calls (e.g. a reporter that itself reports) are dropped to
 *     guarantee termination and avoid unbounded recursion.
 *
 * @param {Error} error The error object caught by the boundary
 * @param {Object} context Additional context (like route info or digest)
 */
export const reportError = (error, context) => {
  const safeContext = scrubContext(context);
  if (isReporting) {
    // Re-entrancy guard: a reporter (or the failsafe) invoked reportError
    // again. Drop the nested call deterministically instead of recursing.
    try {
      console.error("reportError re-entered; dropping nested report", error, safeContext);
    } catch {
      // Swallow: console may be unavailable in exotic environments.
    }
    return;
  }
  isReporting = true;
  try {
    currentReporter(error, safeContext);
  } catch (e) {
    // Failsafe if the injected reporter crashes. We must not lose the
    // original error, so we log both the reporter failure and the original.
    try {
      console.error("Error reporter crashed:", e);
      console.error("Original error:", error, safeContext);
    } catch {
      // Last-resort: even console can be unavailable in exotic environments.
      // Swallow silently rather than throwing from the error boundary.
    }
  } finally {
    isReporting = false;
  }
};
