"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import ErrorBanner from "@/components/ErrorBanner";
import { reportError } from "@/lib/observability/reportError";
import { copy } from "@/app/copy/en";

/**
 * Deterministic fallback surfaced when an automatic recovery attempt fails.
 * Exported so tests can assert on the exact user-visible string.
 */
export const INVEST_DETAIL_RECOVERY_FAILED =
  "Automatic recovery did not succeed. Return to the marketplace or reload the page.";

/**
 * Segment-level error boundary for `/invest/[id]`.
 *
 * Next.js only renders the nearest `error.js`, so without this file any throw
 * inside the invoice-detail segment (e.g. a malformed invoice payload reaching
 * `formatCurrency`) escalates to the root `app/error.js`, which knows nothing
 * about the route and offers no way back to the marketplace. This boundary
 * keeps recovery scoped to the segment that failed.
 *
 * ## State invariants (the reason this file exists)
 * 1. **Exactly-once reporting.** Each distinct `error` instance is reported at
 *    most once. React 18 StrictMode intentionally double-invokes effects in
 *    development; deduping by identity stops a single failure from being
 *    reported twice without suppressing genuine repeat failures (a *new*
 *    error instance is always reported).
 * 2. **Single-flight recovery.** At most one `reset()` is in flight. A
 *    re-entrant click while recovery is running is ignored, so a
 *    double-click (or a `reset` that synchronously forces another render)
 *    cannot queue two competing recovery attempts.
 * 3. **Recovery cannot throw out of the boundary.** A missing or throwing
 *    `reset` is caught, reported, and converted into a deterministic fallback
 *    message instead of unmounting the tree.
 * 4. **Route context is preserved.** The user is never trapped: a stable link
 *    back to `/invest` is always rendered, independent of what failed.
 * 5. **No sensitive data is surfaced.** Only the non-sensitive route `id`
 *    (a public identifier) and `error.digest` are forwarded to the reporter —
 *    never raw error stacks.
 *
 * @param {object}   props
 * @param {Error}    props.error — Error thrown by the segment.
 * @param {Function} props.reset — Re-mounts the segment. Next.js supplies it,
 *   but it is validated defensively because a boundary must never crash the app.
 */
export default function InvoiceDetailError({ error, reset }) {
  const params = useParams();
  const routeId = typeof params?.id === "string" ? params.id : undefined;

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
    reportError(error, { digest: error?.digest, boundary: "invest-detail", routeId });
  }, [error, routeId]);

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
        boundary: "invest-detail-recovery",
        routeId,
      });
      setRecoveryFailed(true);
    } finally {
      recoveringRef.current = false;
    }
  }, [reset, routeId]);

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 py-16 text-slate-100"
      data-testid="invest-detail-error"
    >
      <main
        id="main-content"
        className="w-full max-w-lg"
        aria-labelledby="invest-detail-error-heading"
      >
        <h1 id="invest-detail-error-heading" className="sr-only">
          {copy.error.title}
        </h1>

        <ErrorBanner
          variant="error"
          title={copy.error.title}
          description={recoveryFailed ? INVEST_DETAIL_RECOVERY_FAILED : copy.error.description}
          actionLabel={copy.error.actionLabel}
          previewLabel="Invoice detail"
          onAction={handleRecover}
        />

        {/* Invariant 4 — always leave the user an escape route. */}
        <div className="mt-6 text-center">
          <Link
            href="/invest"
            data-testid="invest-detail-error-back"
            className="inline-block rounded py-3 text-sm text-cyan-400 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400"
          >
            ← Back to marketplace
          </Link>
        </div>
      </main>
    </div>
  );
}
