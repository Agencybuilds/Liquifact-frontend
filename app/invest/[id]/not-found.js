"use client";

/**
 * @file app/invest/[id]/not-found.js
 *
 * Terminal boundary for the invoice-detail route.
 *
 * Rendered by Next.js whenever {@link notFound} is called from
 * `app/invest/[id]/page.js` (unknown / removed invoice id) or when the URL does
 * not resolve to an invoice. This is the *end state* of the detail route: no
 * further state transition happens here except a user-initiated navigation.
 *
 * ## State / invariant contract (owned by this file)
 *
 *  I1 — Recovery preserves route state (no silent state loss).
 *       The "Browse marketplace" action re-enters `/invest` carrying the same
 *       *sanitized* filter state the user arrived with, exactly like the
 *       detail page's back-link. Hitting an unknown invoice must not silently
 *       reset the user's marketplace filters, sort, or maturity range.
 *
 *  I2 — No untrusted parameter reflection.
 *       Only the marketplace's allow-listed keys/values (`q`, `currency`,
 *       `yieldMin`, `yieldMax`, `maturityFrom`, `maturityTo`, `sort`,
 *       `sortDir`, `statuses`) can appear in the recovery href. Unknown keys
 *       (`redirect`, `token`, `state`, …) and out-of-range values are dropped
 *       by {@link getMarketplaceHref}, so this page can never be used as an
 *       open redirect, a parameter-smuggling relay, or a way to elevate
 *       attacker-supplied state into the marketplace.
 *
 *  I3 — Deterministic and idempotent.
 *       Output is a pure function of the URL. No clock, randomness, network,
 *       cookies, or mutable module state is read, and the unknown id is never
 *       consulted. Rendering the boundary repeatedly yields identical markup.
 *
 *  I4 — Safe degradation.
 *       If the query string cannot be read (static / CSR bail-out), the
 *       recovery link degrades to the unfiltered `/invest` — never to an
 *       arbitrary or attacker-controlled destination.
 *
 *  I5 — No data disclosure / no authorization escalation.
 *       The unknown id and query values are never echoed into visible copy,
 *       logs, or structured data. This route is read-only: it triggers no
 *       privileged action and requires no wallet authorization.
 *
 * Accessibility invariants preserved from the previous implementation: a single
 * `<h1>`, one `<main>` landmark labelled by that heading, and two keyboard
 * focusable links with visible focus rings.
 */

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { getMarketplaceHref } from "@/lib/marketplaceRoute";

/** Canonical brand-home destination. Fixed, never derived from user input. */
const HOME_HREF = "/";

/** Fallback destination when the URL query string is unavailable (I4). */
const MARKETPLACE_FALLBACK_HREF = getMarketplaceHref(null);

/**
 * Presentational view. Pure: every render input arrives as a prop, so the same
 * `marketplaceHref` always produces the same markup (I3).
 *
 * @param {{ marketplaceHref: string }} props
 */
function InvoiceNotFoundView({ marketplaceHref }) {
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
