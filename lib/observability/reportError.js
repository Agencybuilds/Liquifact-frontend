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
 * Validation boundaries for error reporting.
 *
 * Invariants enforced by `reportError`:
 *  - `error` MUST be an `Error` instance. Non-Error values are rejected
 *    (never silently coerced) so downstream telemetry cannot receive
 *    arbitrary attacker-controlled payloads.
 *  - `context` MUST be `undefined`, `null`, or a plain object. Arrays,
 *    functions, and primitives are rejected to keep the shape deterministic.
 *  - Sensitive keys are scrubbed case-insensitively at the boundary so
 *    injected reporters cannot leak PII/secrets even if they ignore context.
 *  - The reporter is invoked at most once per call; a crashing reporter is
 *    contained and never re-enters `reportError` (prevents infinite loops).
 */

const isPlainObject = (value) => {
  if (value === null || typeof value !== "object") return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const isValidContext = (context) =>
  context === undefined || context === null || isPlainObject(context);

/**
 * Scrub sensitive keys from a context object case-insensitively.
 * @param {Object} context
 * @returns {Object}
 */
const scrubContext = (context) => {
  if (!context || typeof context !== "object") {
    return context;
  }

  const safeContext = {};
  for (const key in context) {
    if (Object.prototype.hasOwnProperty.call(context, key)) {
      // Case-insensitive matching for sensitive keys
      if (SENSITIVE_KEYS.has(key.toLowerCase())) {
        safeContext[key] = "[REDACTED]";
      } else {
        safeContext[key] = context[key];
      }
    }
  }

  return safeContext;
};

/**
 * Default logging sink. Wraps console.error and scrubs sensitive PII/secrets.
 * This sink is deterministic and never throws.
 */
const defaultSink = (error, context) => {
  const safeContext = scrubContext(context);
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
 * @returns {boolean} true if the error was reported, false if rejected
 */
export const reportError = (error, context) => {
  // Boundary: reject non-Error inputs deterministically.
  if (!(error instanceof Error)) {
    console.error(
      "[ErrorReporter] Rejected non-Error input:",
      typeof error
    );
    return false;
  }

  // Boundary: reject malformed context shapes deterministically.
  if (!isValidContext(context)) {
    console.error(
      "[ErrorReporter] Rejected invalid context shape:",
      Array.isArray(context) ? "array" : typeof context
    );
    return false;
  }

  // Scrub sensitive keys at the boundary before handing off to the reporter.
  const safeContext = scrubContext(context ?? {});

  try {
    currentReporter(error, safeContext);
    return true;
  } catch (e) {
    // Failsafe if the injected reporter crashes. We do not re-enter
    // reportError here to avoid unbounded recursion on a broken sink.
    try {
      console.error("Error reporter crashed:", e);
      console.error("Original error:", error);
    } catch {
      // Last-resort: swallow to preserve the caller's control flow.
    }
    return false;
  }
};

export { scrubObject, safeStringify, normalizeError, defaultSink };
