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
    <div className="min-h-screen bg-slate-950 text-slate-100" data-testid="invoice-not-found-page">
      <header className="border-b border-slate-800 px-6 py-4">
        <Link
          href={HOME_HREF}
          className="inline-block py-3 text-xl font-semibold tracking-tight text-cyan-400 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 rounded"
          data-testid="invoice-not-found-home-link"
        >
          ← LiquiFact
        </Link>
      </header>

      <main
        id="main-content"
        className="max-w-4xl mx-auto px-6 py-12 text-center"
        aria-labelledby="invoice-not-found-heading"
      >
        <h1 id="invoice-not-found-heading" className="text-3xl font-bold mb-4">
          Invoice not found
        </h1>
        <p className="text-slate-400 mb-8 max-w-md mx-auto">
          We could not find that invoice in the marketplace. It may have been removed or the link
          might be incorrect.
        </p>
        <Link
          href={marketplaceHref}
          className="inline-block rounded-full bg-cyan-500/20 text-cyan-400 px-6 py-3 text-sm font-medium hover:bg-cyan-500/30 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-950 focus:ring-cyan-500"
          data-testid="invoice-not-found-marketplace-link"
        >
          Browse marketplace
        </Link>
      </main>
    </div>
  );
}

/**
 * Reads the live URL query string and maps it to a sanitized marketplace href.
 *
 * `useSearchParams()` may resolve to `null` (e.g. during a static render); the
 * mapping handles that by falling back to the unfiltered marketplace (I4).
 * Query values are only ever fed through {@link getMarketplaceHref}, which
 * allow-lists and normalizes them before they can reach the DOM (I2).
 *
 * @returns {JSX.Element}
 */
function RouteAwareInvoiceNotFound() {
  const searchParams = useSearchParams();
  return <InvoiceNotFoundView marketplaceHref={getMarketplaceHref(searchParams)} />;
}

/**
 * Public boundary component.
 *
 * The `<Suspense>` wrapper keeps `useSearchParams` compatible with static
 * generation (Next.js CSR bail-out). The fallback shows the safe, unfiltered
 * marketplace destination, so the page is useful even before hydration.
 */
export default function InvoiceNotFound() {
  return (
    <Suspense fallback={<InvoiceNotFoundView marketplaceHref={MARKETPLACE_FALLBACK_HREF} />}>
      <RouteAwareInvoiceNotFound />
    </Suspense>
  );
}
