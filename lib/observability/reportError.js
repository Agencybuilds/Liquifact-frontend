const SENSITIVE_KEYS = new Set(["password", "token", "secret", "authorization", "cookie"]);

const MAX_DEPTH = 6;
const MAX_ARRAY = 20;
const MAX_STRING_LENGTH = 2000;

/**
 * Redacts sensitive values and limits depth/size to avoid leaking secrets or exhausting memory.
 * This is deterministic and never throws.
 */
const scrubObject = (value, depth, seen) => {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (depth > MAX_DEPTH) {
    return "[MaxDepth]";
  }

  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      const length = Math.min(value.length, MAX_ARRAY);
      const out = new Array(length);
      for (let i = 0; i < length; i++) {
        out[i] = scrubObject(value[i], depth + 1, seen);
      }
      if (value.length > MAX_ARRAY) {
        out.push("[Truncated]");
      }
      return out;
    }

    const out = {};
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = scrubObject(value[key], depth + 1, seen);
      }
    }
    return out;
  } finally {
    seen.delete(value);
  }
};

const safeStringify = (value) => {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized === "string" && serialized.length > MAX_STRING_LENGTH) {
      return serialized.slice(0, MAX_STRING_LENGTH) + "[Truncated]";
    }
    return serialized;
  } catch {
    return "[Unserializable]";
  }
};

/**
 * Normalizes an error into a stable, serializable shape.
 * Ensures deterministic output even for non-Error thrown values.
 */
const normalizeError = (error) => {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message,
      stack: error.stack,
      digest: error.digest,
    };
  }
  if (error && typeof error === "object") {
    return scrubObject(error, 0, new WeakSet());
  }
  return { message: String(error) };
};

/**
 * Default logging sink. Wraps console.error and scrubs sensitive PII/secrets.
 * This sink is deterministic and never throws.
 */
const defaultSink = (error, context) => {
  const safeError = normalizeError(error);
  const safeContext = scrubObject(context, 0, new WeakSet());
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
 * This function is deterministic and never throws. If an injected reporter
 * fails, we fall back to the default sink so failures remain observable.
 * @param {Error} error The error object caught by the boundary
 * @param {Object} context Additional context (like route info or digest)
 */
export const reportError = (error, context) => {
  const reporter = currentReporter;
  try {
    reporter(error, context);
  } catch (reporterError) {
    // Failsafe if the injected reporter crashes. We must not lose the original error.
    try {
      defaultSink(error, context);
    } catch {
      // Ultimate failsafe: defaultSink is designed to never throw, but guard anyway.
    }
    try {
      console.error(
        "Error reporter crashed:",
        reporterError instanceof Error ? reporterError.message : String(reporterError)
      );
    } catch {
      // ignore
    }
  }
};

export { scrubObject, safeStringify, normalizeError, defaultSink };
