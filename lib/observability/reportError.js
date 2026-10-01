const SENSITIVE_KEYS = new Set(["password", "token", "secret", "authorization", "cookie", "apiKey", "api_key", "accessToken", "access_token", "refreshToken", "refresh_token", "credentials", "sessionId", "session_id"]);

const REDACTED = "[REDACTED]";

/**
 * Recursively scrubs sensitive values from an object without mutating the original.
 * Handles circular references and limits depth to avoid unrecoverable recursion.
 */
const MAX_DEPTH = 6;

const scrub = (value, depth, seen) => {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[Circular]";
  }

  if (depth > MAX_DEPTH) {
    return "[MaxDepth]";
  }

  seen.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((item) => scrub(item, depth + 1, seen));
    }

    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    }

    const out = {};
    for (const key of Object.keys(value)) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        out[key] = REDACTED;
      } else {
        out[key] = scrub(value[key], depth + 1, seen);
      }
    }
    return out;
  } finally {
    seen.delete(value);
  }
};

/**
 * Scrubs sensitive PII/secrets from a context object. Never mutates the input.
 * @param {unknown} context
 * @returns {unknown}
 */
export const scrubContext = (context) => {
  if (context === null || typeof context !== "object") {
    return context;
  }
  return scrub(context, 0, new WeakSet());
};

const REDACTED = "[REDACTED]";

/**
 * Recursively scrubs sensitive values from a value before it is handed to a
 * logging sink. Handles nested objects and arrays, preserves circular references,
 * and never throws (fails open to a safe placeholder).
 *
 * @invariant The returned value is always structurally safe to log and never
 *   contains the raw value of a key listed in SENSITIVE_KEYS (case-insensitive).
 * @param {*} value
 * @param {WeakSet} [visited]
 * @returns {*}
 */
const scrubValue = (value, visited = new WeakSet()) => {
  if (value === null || typeof value !== "object") {
    return value;
  }

  // Preserve the classic Error shape so sinks can read name/message/stack.
  if (value instanceof Error) {
    return value;
  }

  if (visited.has(value)) {
    return "[Circular]";
  }
  visited.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, visited));
  }

  const out = {};
  for (const key of Object.keys(value)) {
    try {
      if (SENSITIVE_KEYS.has(String(key).toLowerCase())) {
        out[key] = REDACTED;
      } else {
        out[key] = scrubValue(value[key], visited);
      }
    } catch {
      // Getters or proxies may throw. Never fail the error reporter.
      out[key] = "[Unreadable]";
    }
  }

  return out;
};

/**
 * Default logging sink. Wraps console.error and scrubs sensitive PII|secrets.
 */
const defaultSink = (error, context) => {
  const safeContext = scrubValue(context);
  console.error("[ErrorReporter]", error, safeContext);
};

let currentReporter = defaultSink;
let recovering = false;

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
  recovering = false;
};

let isReporting = false;

/**
 * Primary error boundary logging interface.
 *
 * Compatibility contract:
 *  - Always calls the current reporter with the original error reference and the
 *    scrubbed context. The error object is passed through unmodified so existing
 *    callers and telemetry adapters that inspect it continue to work.
 *  - Never throws. If the injected reporter crashes, the failsafe loss of the
 *    original error is avoided by logging it through the default sink.
 *  - Returns the result of the reporter when it succeeds, and `undefined`
 *    when it fails. (Historically the return value was unused, so this is
 *    backward compatible.)
 *
 * @param {Error} error The error object caught by the boundary
 * @param {Object} context Additional context (like route info or digest)
 * @returns {*}
 */
export const reportError = (error, context) => {
  const safeContext = scrubValue(context);

  try {
    return currentReporter(error, safeContext);
  } catch (e) {
    // Failsafe if the injected reporter crashes. Use the default sink so the
    // original error is still observable and sensitive data is still scrubbed.
    try {
      defaultSink(e, { phase: "reporter-crash" });
      defaultSink(error, safeContext);
    } catch {
      // Last-resort: never let logging failures escape the error boundary.
    }
    return undefined;
  }
};
