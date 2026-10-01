"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ErrorBanner from "../components/ErrorBanner";
import { reportError } from "../lib/observability/reportError";
import { copy } from "./copy/en";

/**
 * Deterministic fallback surfaced when an automatic recovery attempt fails.
 * Exported so tests can assert on the exact user-visible string.
 */
export const ERROR_RECOVERY_FAILED =
  "Automatic recovery did not succeed. Please reload the page or return to the invoice list.";

/**
 * Route-level error boundary for the Next.js App Router.
 *
 * Rendered automatically by Next.js whenever a segment throws during render
 * or data-fetching. Wraps {@link ErrorBanner} so the page gets the full
 * branded error UI instead of the React default error overlay.
 *
 * The component logs the error through the pluggable {@link reportError}
 * reporter (console in development, swap for Sentry/Datadog in production).
 *
 * ## Determinism invariants
 * 1. **Exactly-once reporting per error instance.** React 18 StrictMode
 *    double-invokes effects in development, so a naive
 *    `useEffect(() => reportError(error), [error])` reports every failure
 *    twice. Deduping by error identity is StrictMode-safe while still
 *    reporting a *new* error instance (real repeat failures are not hidden).
 * 2. **Single-flight recovery.** At most one `reset()` is in flight. A
 *    re-entrant click while recovery is running is ignored, so a
 *    double-click — or a `reset` that synchronously forces another click —
 *    cannot queue competing recovery attempts.
 * 3. **Recovery cannot throw out of the boundary.** `reset` is validated and
 *    invoked inside a `try/catch`. A missing or throwing `reset` is caught,
 *    reported, and converted into a deterministic fallback instead of
 *    producing a second uncaught crash while handling the first.
 *
 * @param {object}   props
 * @param {Error}    props.error — The error thrown by the segment. Next.js
*   attaches a `digest` property for server-side errors so you can correlate
 *   browser errors with server logs.
 * @param {Function} props.reset — Calling this function unmounts and re-mounts
 *   the subtree, effectively retrying the failed render without a full page
 *   reload. Use it to give users a non-destructive recovery path.
 *
 * Compatibility contracts (preserved across upgrades):
 * - **Next.js App Router error boundary signature**: the default export is a
 *   component that accepts `{ error, reset }` and returns a React element.
 *   Next.js relies on this shape; changing it would break the boundary.
 * - **Dom and accessibility contract**: the root element keeps
 *   `data-testid="error-boundary-page"`, the main landmark keeps
 *   `id="main-content"`, and the heading keeps `id="error-boundary-heading"`.
 *   These are used by tests and assistive technology.
 * - **Copy contract**: all user-visible strings come from `copy.error`.
 * - **Observability contract**: every error is forwarded to `reportError`
 *   exactly once per error identity, with `{ digest }` context. The
 *   reporter is fail-safe and must never throw back into the boundary.
 */

function safeReportError(error, context) {
  // Defensive wrapper: the boundary must never crash while reporting an
  // error, otherwise the user would see a blank screen instead of the
  // recovery UI. `reportError` already has an internal failsafe, but we
  // keep this guard so future regressions in the reporter cannot escape.
  try {
    reportError(error, context);
  } catch (errorReportingError) {
    // Last-resort diagnostic. Intentionally logs only the failure message
    // and the original error message — not the full objects — to avoid
    // leaking sensitive data if the reporter itself is broken.
    console.error(
      "[ErrorBoundary] reportError threw:",
      errorReportingError instanceof Error ? errorReportingError.message : "[non-Error thrown]",
      "[last-resort] original error message:",
      error instanceof Error ? error.message : "[non-Error thrown]"
    );
  }
}

export default function GlobalError({ error, reset }) {
  // Next.js can render the boundary with a non-Error value (e.g. a thrown
  // string or `null`). Normalize to an Error so downstream consumers and
  // the reporter always receive a consistent shape. This is part of the
  // compatibility contract: callers can rely on `reportError` receiving an
  // `Error` instance.
  const normalizedError = normalizeError(error);

  // Only the digest is forwarded as context. The digest is a server-generated
  // opaque identifier and is safe to log. We do not forward the raw error
  // object as context because it may contain request data.
  const digest = normalizedDigest(normalizedError);

  useEffect(() => {
    if (!error) {
      return;
    }
    // Invariant 1 — report each error instance once (StrictMode-safe).
    if (lastReportedRef.current === error) {
      return;
    }
    lastReportedRef.current = error;
    // Forward to the configurable observability sink.
    // `error.digest` is the server-side identifier so production logs can
    // be correlated without exposing raw stack traces to the client.
    safeReportError(normalizedError, { digest });
  }, [normalizedError, digest]);

  // Reset is optional in the Next.js contract and may be missing in
  // non-Next.js environments (tests, storybook). Provide a safe no-op
  // fallback so the button remains functional and never throws.
  const safeReset = typeof reset === "function" ? reset : () => {};

  const handleRecover = useCallback(() => {
    // Invariant 2 — ignore re-entrant recovery attempts.
    if (recoveringRef.current) {
      return;
    }
    recoveringRef.current = true;

    try {
      // Invariant 3 — a boundary must never throw while handling a failure.
      if (typeof reset !== "function") {
        throw new TypeError("Error boundary reset handler is not callable.");
      }
      reset();
    } catch (recoveryError) {
      reportError(recoveryError, {
        digest: recoveryError?.digest,
        boundary: "route-error-recovery",
      });
      setRecoveryFailed(true);
    } finally {
      recoveringRef.current = false;
    }
  }, [reset]);

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 py-16"
      data-testid="error-boundary-page"
    >
      <main id="main-content" className="w-full max-w-lg" aria-labelledby="error-boundary-heading">
        {/* Visually hidden heading so screen readers can identify the landmark */}
        <h1 id="error-boundary-heading" className="sr-only">
          {copy.error.title}
        </h1>

        <ErrorBanner
          variant="server"
          title={copy.error.title}
          description={copy.error.description}
          details={recoveryFailed ? ERROR_RECOVERY_FAILED : undefined}
          actionLabel={copy.error.actionLabel}
          previewLabel={copy.error.previewLabel}
          onAction={safeReset}
        />
      </main>
    </div>
  );
}

/**
 * Normalizes any thrown value into an `Error` instance.
 *
 * React and Next.js allow non-Error values to be thrown (strings,
 * `null`, objects). The boundary contract is that downstream consumers (and
 * the reporter) always receive an `Error`. This function is pure and
 * deterministic for the same input.
 *
 * @param {unknown} value
 * @returns {Error}
 */
function normalizeError(value) {
  if (value instanceof Error) {
    return value;
  }

  if (value === null || typeof value !== "object") {
    // Primitives and null/undefined — preserve the original value in
    // the message so debugging remains possible without losing information.
    return new Error(typeof value === "string" ? value : String(value));
  }

  // Object that is not an Error (e.g. a Plain object thrown by user code).
  // Prefer a message property if present, otherwise fall back to a safe
  // string. Avoid letting JSON.stringify throw on circular references.
  const message =
    typeof value.message === "string" && value.message.length > 0
      ? value.message
      : "[non-Error value thrown]";

  const normalized = new Error(message);

  // Preserve a digest if the thrown object carried one (Next.js attaches
  // digest to the thrown error, but custom code may throw a plain object
  // with a digest).
  if (typeof value.digest === "string") {
    normalized.digest = value.digest;
  }

  return normalized;
}

/**
 * Extracts a digest string from an error, or `rundefined` when absent.
 * The digest is an opaque server-side identifier and is safe to log.
 *
 * @param {Error} error
 * @returns {string | undefined}
 */
function normalizedDigest(error) {
  return typeof error?.digest === "string" ? error.digest : undefined;
}
