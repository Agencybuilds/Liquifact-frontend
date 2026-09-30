const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "secret",
  "authorization",
  "cookie",
  "apikey",
  "api_key",
  "access_token",
  "refresh_token",
  "session",
  "credit_card",
  "card_number",
  "cvv",
  "ssn",
]);

const MAX_CONTEXT_DEPTH = 4;
const MAX_CONTEXT_KEYS = 50;
const MAX_STRING_LENGTH = 2000;

/**
 * Recursively scrubs sensitive keys and bounds the size of the context
 * so that a single failure cannot produce unbounded logs or leak secrets.
 * Cycles are handled deterministically via a WeakSet.
 */
const scrubValue = (value, depth, seen) => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]`
      : value;
  }

  if (typeof value !== "object") {
    return value;
  }

  if (depth >= MAX_CONTEXT_DEPTH) {
    return "[MaxDepthExceeded]";
  }

  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.slice(0, MAX_CONTEXT_KEYS).map((item) => scrubValue(item, depth + 1, seen));
  }

  const result = {};
  let count = 0;
  for (const key in value) {
    if (!Object.hasOwn(value, key)) continue;
    if (count >= MAX_CONTEXT_KEYS) {
      result["__truncated__"] = true;
      break;
    }
    count += 1;
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = scrubValue(value[key], depth + 1, seen);
    }
  }
  return result;
};

/**
 * Normalizes an unknown thrown value into a serializable, non-sensitive shape.
 * Guarantees that reporting never throws on exotic inputs (e.g. thrown strings,
 * DOMException, or objects with throwing getters).
 */
const normalizeError = (error) => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      digest: error.digest,
    };
  }
  if (typeof error === "string") {
    return { name: "NonError", message: error };
  }
  try {
    return { name: "NonError", message: String(error) };
  } catch {
    return { name: "NonError", message: "[UnserializableError]" };
  }
};

/**
 * Default logging sink. Wraps console.error and scrubs sensitive PII/secrets.
 */
const defaultSink = (error, context) => {
  const safeError = normalizeError(error);
  const safeContext = scrubValue(context, 0, new WeakSet());

  console.error("[ErrorReporter]", safeError, safeContext);
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

/**
 * Primary error boundary logging interface.
 * @param {Error} error The error object caught by the boundary
 * @param {Object} context Additional context (like route info or digest)
 */
export const reportError = (error, context) => {
  // Snapshot the reporter so a concurrent setReporter/resetReporter cannot
  // change the sink mid-call (deterministic behavior under concurrency).
  const reporter = currentReporter;
  try {
    reporter(error, context);
  } catch (e) {
    // Failsafe if the injected reporter crashes. Never rethrow: reporting
    // failures must not mask the original error or break the caller.
    try {
      console.error("Error reporter crashed:", normalizeError(e));
      console.error("Original error:", normalizeError(error));
    } catch {
      // Last-resort guard: console itself may be unavailable.
    }
  }
};
