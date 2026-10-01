/**
 * @file app/invest/[id]/loading.js
 *
 * Streaming loading skeleton for the invoice-detail route.
 *
 * Next.js renders this file as the fallback while `page.js` (the Server
 * Component) is still streaming.  It must:
 *
 *  1. **Mirror `page.js` structure** so there is no layout shift when the
 *     real page replaces the skeleton.  `page.js` renders: NavMenu header →
 *     back-link → h1 → InvoiceDetailClient card → InvoiceDetailItems section
 *     → InvoiceDetailExport row → InvoiceTimeline → FundActions bar.
 *     Each is approximated here with skeleton shapes of matching dimensions.
 *
 *  2. **Expose `id="main-content"` on `<main>`** so `RouteFocus` (mounted
 *     in `page.js`) can move focus to the content region immediately after
 *     hydration rather than failing silently with `getElementById` returning
 *     `null`.
 *
 *  3. **Announce the loading state to assistive technology** via a polite
 *     `aria-live="polite"` / `role="status"` region inside `<main>` so
 *     screen-reader users know a page is loading rather than experiencing
 *     silence.  `aria-busy="true"` on the outer wrapper is the secondary
 *     signal for AT that already understands the attribute.
 *
 *  4. **Use the copy dictionary** (`copy.invoiceTimeline.loadingState`) as
 *     the single source of truth for the loading label, consistent with
 *     how all other user-visible strings are managed in this codebase.
 *
 *  5. **Use stable, descriptive element keys** (never bare index `key={i}`)
 *     so React can reconcile the skeleton without dev-mode warnings.
 *
 * Failure-recovery contract
 * ──────────────────────────
 * When `page.js` throws (e.g. network error, unexpected exception), Next.js
 * replaces this skeleton with `app/invest/[id]/error.js`.  When `notFound()`
 * is called, Next.js replaces it with `app/invest/[id]/not-found.js`.  Both
 * boundaries are already implemented.
 *
 * This component's responsibility is to occupy the DOM cleanly while the
 * outcome is unknown — matching dimensions prevent cumulative layout shift
 * (CLS), the live region announces progress, and `id="main-content"` means
 * focus management works regardless of which boundary ultimately renders.
 *
 * This file is a Server Component (no `"use client"` directive) — it is
 * rendered entirely on the server, shipped as HTML, and never re-renders
 * on the client.  No hooks, no browser APIs.
 */

import NavMenuSkeleton from "@/components/NavMenuSkeleton";
import { copy } from "@/app/copy/en";

// The loading label lives in the copy dictionary so wording can change from
// one place without touching this component.
const LOADING_LABEL = copy.invoiceTimeline.loadingState;

// ── Skeleton layout constants ─────────────────────────────────────────────────

/**
 * Detail-card field rows to simulate.
 * Lengths are chosen to approximate the actual field-label widths so the
 * skeleton has realistic proportions without hard-coding real data.
 */
const DETAIL_FIELD_ROWS = [
  { id: "skeleton-field-issuer", labelW: "w-12", valueW: "w-40" },
  { id: "skeleton-field-amount", labelW: "w-14", valueW: "w-28" },
  { id: "skeleton-field-yield", labelW: "w-28", valueW: "w-16" },
  { id: "skeleton-field-maturity", labelW: "w-24", valueW: "w-24" },
  { id: "skeleton-field-status", labelW: "w-12", valueW: "w-16" },
  { id: "skeleton-field-reference", labelW: "w-20", valueW: "w-32" },
];

/**
 * Timeline stage circles to approximate InvoiceTimeline.
 * Five stages: Uploaded → Verified → Listed → Funded → Settled.
 */
const TIMELINE_STAGES = [
  "skeleton-stage-uploaded",
  "skeleton-stage-verified",
  "skeleton-stage-listed",
  "skeleton-stage-funded",
  "skeleton-stage-settled",
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function InvoiceDetailLoading() {
  return (
    /*
     * aria-busy="true" signals to AT that this region's content is in flux.
     * It is cleared automatically when Next.js swaps in the real page (or an
     * error/not-found boundary), which renders without the attribute.
     */
    <div className="min-h-screen bg-slate-950 text-slate-100" aria-busy="true">
      {/* ── Navigation skeleton ──────────────────────────────────────── */}
      <NavMenuSkeleton />

      {/*
       * id="main-content" mirrors the real page.js so:
       *  a) RouteFocus.useEffect → getElementById("main-content") succeeds,
       *  b) the skip-link target is present throughout the loading period.
       */}
      <main id="main-content" className="max-w-4xl mx-auto px-6 py-12">
        {/*
         * Polite live region — announces loading state to screen readers.
         * role="status" + aria-live="polite" is the correct pairing for
         * non-critical progress notifications (WCAG 4.1.3 / ARIA 1.2).
         * aria-atomic="true" ensures the full string is read as a unit.
         */}
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {LOADING_LABEL}
        </div>

        {/* ── Back-link skeleton ──────────────────────────────────────── */}
        {/* Mirrors: <Link href={backHref}>← Back to marketplace</Link> */}
        <div
          className="h-4 w-36 rounded bg-slate-800 animate-pulse mb-6"
          aria-hidden="true"
        />

        {/* ── Page heading skeleton ───────────────────────────────────── */}
        {/* Mirrors: <h1>Invoice details</h1> + <p>…pageSub…</p> */}
        <div
          className="h-7 w-40 rounded bg-slate-700 animate-pulse mb-2"
          aria-hidden="true"
        />
        <div
          className="h-4 w-72 rounded bg-slate-800 animate-pulse mb-8"
          aria-hidden="true"
        />

        {/* ── Invoice detail card skeleton ────────────────────────────── */}
        {/*
         * Mirrors InvoiceDetailClient: a rounded-xl card with a heading row
         * (issuer name + density toggle) and a 2-col definition list below.
         */}
        <section
          aria-hidden="true"
          className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 mb-6"
        >
          {/* Heading row: issuer name skeleton + density-toggle placeholder */}
          <div className="flex items-center justify-between mb-4">
            <div className="h-6 w-48 rounded bg-slate-700 animate-pulse" />
            <div className="h-8 w-40 rounded-lg bg-slate-800 animate-pulse" />
          </div>

          {/* 2-column definition-list skeleton */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {DETAIL_FIELD_ROWS.map(({ id, labelW, valueW }) => (
              <div key={id} className="space-y-1.5">
                {/* dt placeholder */}
                <div className={`h-3 ${labelW} rounded bg-slate-800 animate-pulse`} />
                {/* dd placeholder */}
                <div className={`h-4 ${valueW} rounded bg-slate-700 animate-pulse`} />
              </div>
            ))}
          </div>
        </section>

        {/* ── Invoice detail documents section skeleton ───────────────── */}
        {/*
         * Mirrors InvoiceDetailItems: heading row + 3 document-list rows
         * with checkbox-width + name + action-button placeholders.
         */}
        <section
          aria-hidden="true"
          className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 mb-6"
        >
          {/* Section heading + sub-text */}
          <div className="h-5 w-40 rounded bg-slate-700 animate-pulse mb-1" />
          <div className="h-3.5 w-64 rounded bg-slate-800 animate-pulse mb-4" />

          {/* Document rows */}
          {["skeleton-doc-row-0", "skeleton-doc-row-1", "skeleton-doc-row-2"].map((rowId) => (
            <div
              key={rowId}
              className="flex items-center gap-3 py-2 border-b border-slate-800/60 last:border-0"
            >
              {/* Checkbox placeholder */}
              <div className="h-4 w-4 rounded bg-slate-800 animate-pulse shrink-0" />
              {/* Name placeholder */}
              <div className="h-3.5 flex-1 max-w-xs rounded bg-slate-700 animate-pulse" />
              {/* Action-button placeholder */}
              <div className="h-7 w-16 rounded bg-slate-800 animate-pulse shrink-0" />
            </div>
          ))}
        </section>

        {/* ── Export row skeleton ─────────────────────────────────────── */}
        {/* Mirrors InvoiceDetailExport: two side-by-side button outlines */}
        <div
          aria-hidden="true"
          className="flex gap-3 mb-6"
        >
          <div className="h-8 w-28 rounded-lg bg-slate-800 animate-pulse" />
          <div className="h-8 w-28 rounded-lg bg-slate-800 animate-pulse" />
        </div>

        {/* ── Timeline skeleton ───────────────────────────────────────── */}
        {/*
         * Mirrors InvoiceTimeline: a heading and a horizontal stepper with
         * five circles connected by lines.
         */}
        <section
          aria-hidden="true"
          className="rounded-xl border border-slate-800 bg-slate-900/50 p-6 mb-6"
        >
          {/* "Invoice lifecycle" heading */}
          <div className="h-5 w-36 rounded bg-slate-700 animate-pulse mb-4" />

          {/* Five-stage stepper */}
          <div className="flex items-center gap-0">
            {TIMELINE_STAGES.map((stageId, i) => (
              <div key={stageId} className="flex items-center flex-1 last:flex-none">
                {/* Stage circle */}
                <div className="h-8 w-8 rounded-full bg-slate-800 animate-pulse shrink-0" />
                {/* Connector line (absent after the last stage) */}
                {i < TIMELINE_STAGES.length - 1 && (
                  <div className="h-0.5 flex-1 bg-slate-800 animate-pulse" />
                )}
              </div>
            ))}
          </div>

          {/* Stage label row */}
          <div className="flex justify-between mt-2">
            {TIMELINE_STAGES.map((stageId) => (
              <div
                key={`${stageId}-label`}
                className="h-3 w-12 rounded bg-slate-800 animate-pulse"
              />
            ))}
          </div>
        </section>

        {/* ── Fund-actions bar skeleton ───────────────────────────────── */}
        {/*
         * Mirrors FundActions: a row of three action buttons (Fund / Copy
         * link / Print) with matching approximate widths.
         */}
        <div
          aria-hidden="true"
          className="flex flex-wrap gap-3"
        >
          <div className="h-10 w-36 rounded-full bg-slate-800 animate-pulse" />
          <div className="h-10 w-28 rounded-full bg-slate-800 animate-pulse" />
          <div className="h-10 w-32 rounded-full bg-slate-800 animate-pulse" />
        </div>
      </main>
    </div>
  );
}
