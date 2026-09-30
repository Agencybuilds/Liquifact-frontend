import Link from "next/link";

/**
 * Not-found boundary for the invoice detail route (`/invest/[id]`).
 *
 * Compatibility contract (preserved across errors, empty data, and upgrades):
 * - Default export is a zero-props React component, so Next.js can render it
 *   from `notFound()` without any additional wiring.
 * - The component is deterministic and side-effect free: it never reads route
 *   params, search params, or global state, so it renders identically for
 *   every missing/invalid invoice ID (including malformed or duplicate ids).
 * - The two recovery affordances (back to home, browse marketplace) are
 *   stable public behavior and must not be removed or repointed without a
 *   migration note.
 * - All copy is static and non-sensitive; no invoice identifier or error
 *   detail is echoed to the UI, preventing leakage through the not-found path.
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
      <main className="max-w-4xl mx-auto px-6 py-12 text-center" id="main-content">
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
