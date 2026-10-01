"use client";
import InvoiceListSkeleton from "../../components/InvoiceListSkeleton";
import NavMenuSkeleton from "../../components/NavMenuSkeleton";

/**
 * Route-level loading UI for /invest.
 *
 * Invariants:
 *   - Pure and side-effect-free: rendering this component must not
     mutate module state, caches, or storage. This guarantees that
     concurrent or repeated renders (React StrictMode double-invoke,
     Suspense retries, route prefetch + navigation races)
     produce identical output and cannot leak stale or inconsistent
     state into the app.
   - Deterministic markup: the list of placeholder rows is derived from a
     constant length, not from any external input, so two renders
     of the same component always yield the same tree.
 *   - No asynchronous work is started during render, so there is no
     window for a racing request to interfere with the loading state.
 */

const PLACEHOLDER_ROWS = 3;
const PLACEHOLDER_ACTIONS = 4;

export default function InvestLoading() {
  return (
    <div
      data-testid="invest-loading"
      className="min-h-screen bg-slate-950 text-slate-100"
      aria-busy="true"
    >
      <NavMenuSkeleton />

      <main className="max-w-4xl mx-auto px-6 py-12">
        <div className="h-7 w-24 rounded bg-slate-700 animate-pulse mb-2" />
        <div className="h-4 w-full max-w-xl rounded bg-slate-800 animate-pulse mb-2" />
        <div className="h-4 w-3/4 max-w-lg rounded bg-slate-800 animate-pulse mb-8" />

        <div className="mb-8 rounded-xl border border-slate-800 bg-slate-900/30 p-6">
          <div className="flex flex-wrap gap-4">
            {Array.from({ length: PLACEHOLDER_ACTIONS }).map(( i) => (
              <div key={i} className="h-10 w-32 rounded-lg bg-slate-800 animate-pulse" />
            ))
          </div>
        </div>

        <InvoiceListSkeleton rows={PLACEHOLDER_ROWS} />
      </main>
    </div>
  );
}
