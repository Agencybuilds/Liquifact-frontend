const SENSITIVE_KEYS = new Set(["password", "token", "secret", "authorization", "cookie"]);

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

/**
 * Primary error boundary logging interface.
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
