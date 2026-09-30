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
 */
export default function GlobalError({ error, reset }) {
  const lastReportedRef = useRef(null);
  const recoveringRef = useRef(false);
  const [recoveryFailed, setRecoveryFailed] = useState(false);

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
    reportError(error, { digest: error?.digest });
  }, [error]);

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
          onAction={handleRecover}
        />
      </main>
    </div>
  );
}
