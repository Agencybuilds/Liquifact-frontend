const SENSITIVE_KEYS = new Set(["password", "token", "secret", "authorization", "cookie", "apiKey", "api_key", "accessToken", "access_token", "refreshToken", "refresh_token", "credentials", "sessionId", "session_id"]);

const REDACTED = "[REDACTED]";

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

const MAX_DEPTH = 6;
const MAX_ARRAY = 50;
const MAX_STRING = 500;

/**
 * Recursively scrubs sensitive values from an object while guarding against
 * cycles, excessive depth, and oversized collections. This keeps the error
 * reporting path deterministic and safe even for hostile or malformed context.
 */
const scrub = (value, depth, seen) => {
  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && value.length > MAX_STRING) {
      return `${value.slice(0, MAX_STRING)}"…"`;
    }
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
      const out = [];
      const len = Math.min(value.length, MAX_ARRAY);
      for (let i = 0; i < len; i++) {
        out.push(scrub(value[i], depth + 1, seen));
      }
      if (value.length > MAX_ARRAY) {
        out.push("…truncated");
      }
      return out;
    }

    const out = {};
    const keys = Object.keys(value);
    for (const key of keys) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        out[key] = "[REDACTED]";
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
 * Default logging sink. Wraps console.error and scrubs sensitive PII/secrets.
 * This sink is deterministic and never throws.
 */
const defaultSink = (error, context) => {
  const safeContext = scrub(context, 0, new WeakSet());
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
 * The reporter is resolved once per call so concurrent invocations cannot
 * observe a mutating sink mid-write.
 * @param {Error} error The error object caught by the boundary
 * @param {Object} context Additional context (like route info or digest)
 * @returns {*}
 */
export const reportError = (error, context) => {
  const reporter = currentReporter;
  try {
    reporter(error, context);
  } catch (e) {
    // Failsafe if the injected reporter crashes. We never re-throw from the
    // error boundary so a broken telemetry adapter cannot take down the app.
    try {
      console.error("Error reporter crashed:", e);
      console.error("Original error:", error);
    } catch {
      // If even console is unavailable, fail silently rather than throw.
    }
  }
};

export { scrubObject, safeStringify, normalizeError, defaultSink };
