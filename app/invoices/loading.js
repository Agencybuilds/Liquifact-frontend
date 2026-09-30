/**
 * @file app/invoices/loading.js
 * Next.js route-level loading UI for the /invoices page.
 *
 * Rendered automatically by the Next.js App Router while the page segment
 * is streaming. Delegates the upload area skeleton to the reusable
 * UploadSkeleton component so both share the same markup and stay in sync.
 *
 * ## Deterministic failure recovery
 *
 * This segment is a pure, side-effect-free presentational component: it
 * never fetches, mutates, or persists anything. That invariant is what
 * makes failure recovery deterministic — there is no partial state to
 * lose and no concurrent execution to race against. To keep it that way
 * while still being observable and recoverable, this file:
 *
 * 1. Guarantees the component is a deterministic function of its props.
 *    It accepts no props, so two renders of the same input always produce
 *    the same output.
 * 2. Surfaces a stable `data-testid` hook so tests and monitoring can
 *    assert the loading boundary is active without inspecting internals.
 * 3. Declares `aria-busy` and `aria-live` so assistive technology and
 *    automation can observe the transient state and recover from it.
 * 4. Does not expose sensitive data: no invoice content, no credentials,
 *    no user-specific identifiers are rendered or logged.
 *
 * Because the component is pure, a failure in any downstream data load
 * cannot corrupt this segment; the App Router will replace it with the
 * page or its error boundary once the segment resolves. Retries are
 * idempotent because re-rendering this file has no observable side effect.
 *
 * @see components/UploadSkeleton.jsx — reusable upload skeleton
 */
import UploadSkeleton from "../../components/UploadSkeleton.jsx";

/**
 * Stable test hook for the invoices loading boundary.
 * @type {string}
 */
export const INVOICES_LOADING_TESTID = "invoices-loading";

/**
 * Route-level loading UI for /invoices.
 *
 * Invariants:
 * - Pure and deterministic: no props, no state, no effects, no network.
 * - Always marks the segment as busy and live for assistive technology.
 * - Never renders user or invoice data.
 *
 * @returns {JSX.Element}
 */
export default function InvoicesLoading() {
  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-100"
      aria-busy="true"
      aria-live="polite"
      data-testid={INVOICES_LOADING_TESTID}
    >
      {/* ---- Header ---- */}
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="inline-block py-3 text-xl font-semibold tracking-tight text-transparent bg-slate-700 rounded w-28 animate-pulse">
          ← LiquiFact
        </div>
        <div className="h-11 w-36 rounded-full bg-slate-800 animate-pulse" />
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        {/* ---- Page title ---- */}
        <div className="h-7 w-28 rounded bg-slate-700 animate-pulse mb-6" />
        {/* ---- Subtitle lines ---- */}
        <div className="h-4 w-full max-w-xl rounded bg-slate-800 animate-pulse mb-2" />
        <div className="h-4 w-2/3 max-w-lg rounded bg-slate-800 animate-pulse mb-8" />

        {/* ---- Reusable upload skeleton ---- */}
        <UploadSkeleton isBusy={true} />
      </main>
    </div>
  );
}
