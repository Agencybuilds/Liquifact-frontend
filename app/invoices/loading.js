// @ts-check
/**
 * @file app/invoices/loading.js
 * Next.js route-level loading UI for the /invoices page.
 *
 * Rendered automatically by the Next.js App Router while the page segment
 * is streaming. Delegates the upload area skeleton to the reusable
 * UploadSkeleton component so both share the same markup and stay in sync.
 *
 * ## State invariants
 * This component is a pure, stateless loading shell. It owns no mutable
 * state and must never introduce side effects. The invariants it guarantees:
 *
 *  1. Determinism — given the same props the output is byte-for-byte
 *     identical. The component accepts no props and reads no external
 *     state, so concurrent renders and retries cannot diverge.
 *  2. Accessibility — the root carries `aria-busy="true"` and an
 *     associated `data-testid` hook so tests and assistive technology
 *     can reliably locate the loading region. The `sr-only` announcement
 *     is owned by `UploadSkeleton` and must not be duplicated here.
 *  3. No data leakage — the skeleton renders only placeholder markup.
 *     It must never read or render user data, tokens, or any sensitive
 *     values.
 *  4. No layout shift — the skeleton mirrors the real page sizes.
 *
 * @see components/UploadSkeleton.jsx — reusable upload skeleton
 */
import UploadSkeleton from "../../components/UploadSkeleton";

export default function InvoicesLoading() {
  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-100"
      aria-busy="true"
      data-testid="invoices-loading"
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
