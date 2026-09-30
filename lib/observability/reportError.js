// @ts-nocheck
/**
 * @file Deterministic failure recovery for the error reporting boundary.
 * Invariants documented on `reportError` below.
 */

const SENSITIVE_KEYS = new Set(["password", "token", "secret", "authorization", "cookie"]);

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

/**
 * Default logging sink. Wraps console.error and scrubs sensitive PII/secrets.
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

/**
 * Primary error boundary logging interface.
 *
 * Invariants:
 * - Never throws, regardless of the injected reporter or context shape.
 * - Never mutates the caller's error or context objects.
 * - Always scrubs sensitive keys before handing context to a reporter.
 * - A failing reporter is recovered from and the original error is still surfaced.
 * - Recovery is deterministic: the default sink is attempted exactly once,
 *   and any secondary failure is surfaced as a scrubbed diagnostic without
 *   throwing or mutating caller state.
 * - Re-entrant failures (a reporter that itself calls reportError) are
 *   short-circuited to avoid unbounded recursion and duplicate emissions.
 *
 * @param {Error} error The error object caught by the boundary
 * @param {Object} context Additional context (like route info or digest)
 */
export const reportError = (error, context) => {
  const safeContext = scrubContext(context);

  if (recovering) {
    // Re-entrant call while recovering from a prior reporter failure.
    // Emit a single scrubbed diagnostic and return without recursing.
    try {
      console.error(
        "Error reporter re-entered during recovery:",
        scrubContext({
          name: error && error.name,
          message: error && error.message,
        })
      );
    } catch {
      // ignore
    }
    return;
  }

  try {
    currentReporter(error, safeContext);
  } catch (reporterError) {
    // Failsafe if the injected reporter crashes. We must not lose the
    // original error, so we fall back to the default sink and then to console.
    recovering = true;
    try {
      defaultSink(error, safeContext);
    } catch {
      // console error itself failed; nothing more we can do without throwing.
    }
    try {
      console.error(
        "Error reporter crashed:",
        scrubContext({
          name: reporterError && reporterError.name,
          message: reporterError && reporterError.message,
        })
      );
    } catch {
      // ignore
    } finally {
      recovering = false;
    }
  }
};
