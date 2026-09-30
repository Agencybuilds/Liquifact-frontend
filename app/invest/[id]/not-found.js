// @ts-nocheck
import Link from "next/link";

/**
 * Not-found boundary for the invest detail route.
 *
 * Invariants:
 * - This component is a React Server Component and must remain completely
 *   pure: no module-level mutable state, no timers, no network calls, no
 *   side effects. This makes it safe to render concurrently and repeatedly
 *   without producing stale or inconsistent output.
 * - The component is idempotent: rendering it N times with the same props
 *   yields the same tree. There is no data dependency that could leak between
 *   requests.
 * - No user-supplied input is echoed back into the DOM, so there is no reflected-input / XSS surface here.
 * - This module is a pure function of its props and contains no mutable
 *   module-level bindings, so concurrent or repeated rendering cannot
 *   observe or produce stale state.
 * - The default export is stable across renders (no dynamic keys, no
 *   randomness, no Date.now), keeping output deterministic.
 */

export default function InvoiceNotFound() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4">
        <Link
          href="/"
          className="inline-block py-3 text-xl font-semibold tracking-tight text-cyan-400 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 rounded"
        >
          ← LiquiFact
        </Link>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12 text-center">
        <h1 className="text-3xl font-bold mb-4">Invoice not found</h1>
        <p className="text-slate-400 mb-8 max-w-md mx-auto">
          We could not find that invoice in the marketplace. It may have been removed or the link
          might be incorrect.
        </p>
        <Link
          href="/invest"
          className="inline-block rounded-full bg-cyan-500/20 text-cyan-400 px-6 py-3 text-sm font-medium hover:bg-cyan-500/30 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:ring-cyan-500"
        >
          Browse marketplace
        </Link>
      </main>
    </div>
  );
}
