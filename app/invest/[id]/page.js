/**
 * @file app/invest/[id]/page.js
 *
 * Server Component shell for the invoice detail page.
 *
 * RSC split rationale
 * ───────────────────
 * The previous version was a single "use client" module, meaning every
 * formatting helper, copy string, and layout byte shipped to the browser on
 * the highest-intent route.  This file contains NO browser APIs and NO
 * React hooks — it runs entirely on the server, so headings, the metadata
 * table, and JSON-LD script are streamed as HTML and never appear in the JS
 * bundle.
 *
 * Interactive pieces are delegated to small client boundaries:
 *   - `InvoiceDetailClient` — density toggle + metadata
 *   - `InvoiceDetailItems` — bulk-select toolbar over detail documents
 *   - `FundActions` — fund / copy link / print
 *
 * Data flow
 * ─────────
 * `params.id` → `getInvoiceById(id)` (sync, mock data for now)
 *             → `notFound()` if the id is unknown
 *             → RSC renders layout + passes props to client islands
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import NavMenu from "@/components/NavMenu";
import StatusPill from "@/components/StatusPill";
import InvoiceTimeline from "@/components/InvoiceTimeline";
import { copy } from "@/app/copy/en";
import { INVALID_VALUE_FALLBACK, formatCurrency, formatAmount } from "@/lib/format/currency";
import { getInvoiceById } from "../lib";
import FundActions from "./FundActions";
import { RouteFocus } from "./FocusManager";
import InvoiceDetailClient from "./InvoiceDetailClient";
import InvoiceDetailItems, { buildInvoiceDetailItems } from "./InvoiceDetailItems";
import InvoiceDetailExport from "./InvoiceDetailExport";
import { getMarketplaceHref } from "@/lib/marketplaceRoute";

const detail = copy.invest.detail;

// ── Pure server-side helpers (not exported to the client bundle) ──────────────

/**
 * Invariant: the dynamic route segment `id` must be a non-empty string
 * matching the canonical invoice identifier shape. Anything else is a
 * malformed request and must be rejected deterministically before any
 * data lookup occurs, so that downstream state (notFound vs. render)
 * is never ambiguous.
 *
 * Accepted shape: 1–64 characters of [A-Za-z0-9_-]. This matches the
 * mock data ids and prevents path traversal, whitespace smuggling, and
 * unbounded-length inputs from reaching `getInvoiceById`.
 *
 * @param {unknown} raw
 * @returns {string|null} normalized id, or null when invalid
 */
function normalizeInvoiceId(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 64) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * Invariant: the invoice object returned by the data layer must expose
 * the fields the page relies on. A partially-populated invoice would
 * silently render `undefined` into the DOM and JSON-LD, so we treat a
 * shape violation as "not found" rather than rendering a broken page.
 *
 * @param {unknown} invoice
 * @returns {boolean}
 */
function isRenderableInvoice(invoice) {
  if (!invoice || typeof invoice !== "object") return false;
  if (typeof invoice.id !== "string" || invoice.id.length === 0) return false;
  if (typeof invoice.issuer !== "string") return false;
  if (typeof invoice.status !== "string") return false;
  return true;
}

/**
 * Invariant: `searchParams` may arrive as a plain object, a Promise, or
 * (in adversarial cases) a non-object. Normalize to a plain object so
 * `getMarketplaceHref` always receives a stable, deterministic input and
 * cannot be tricked into reflecting arbitrary values.
 *
 * @param {unknown} raw
 * @returns {Record<string, unknown>}
 */
function normalizeSearchParams(raw) {
  if (!raw || typeof raw !== "object") return {};
  return raw;
}

/**
 * Format a yield value as a percentage string.
 * Falls back to `INVALID_VALUE_FALLBACK` for unresolvable values.
 *
 * @param {string|number|null|undefined} value
 * @returns {string}
 */
function formatYield(value) {
  const formatted = formatAmount(value);
  return formatted === INVALID_VALUE_FALLBACK ? formatted : `${formatted}%`;
}

/**
 * Sanitize a plain-text value for safe use in JSON-LD.
 * Removes leading/trailing whitespace and strips characters that could
 * break out of a JSON string context when embedded in a `<script>`.
 *
 * @param {unknown} value
 * @returns {string}
 */
function sanitizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .trim()
    .replace(/[<>{}"']/g, "");
}

/**
 * Build a JSON-LD `Offer` object for the invoice.
 * Returns `null` when invoice is absent.
 *
 * @param {object|null} invoice
 * @returns {object|null}
 */
function buildInvoiceJsonLd(invoice) {
  if (!invoice) return null;

  const issuer = sanitizeText(invoice.issuer);
  const amount = sanitizeText(invoice.amount);
  const currency = sanitizeText(invoice.currency);
  const dueDate = sanitizeText(invoice.dueDate);
  const yieldValue = sanitizeText(invoice.yield);
  const status = sanitizeText(invoice.status);

  const descriptionParts = [
    issuer ? `Invoice offering from ${issuer}` : "Invoice offering",
    amount ? `Amount ${amount}` : null,
    currency ? `Currency ${currency}` : null,
    dueDate ? `Maturity ${dueDate}` : null,
    yieldValue ? `Estimated yield ${yieldValue}` : null,
    status ? `Status ${status}` : null,
  ].filter(Boolean);

  return {
    "@context": "https://schema.org",
    "@type": "Offer",
    name: issuer ? `Invoice offering from ${issuer}` : "Invoice offering",
    description: descriptionParts.join(". "),
    seller: issuer ? { "@type": "Organization", name: issuer } : undefined,
    price: amount || undefined,
    priceCurrency: currency || undefined,
    availability: status === "Open" ? "https://schema.org/InStock" : undefined,
    validFrom: dueDate || undefined,
  };
}

// ── Server Component ──────────────────────────────────────────────────────────

/**
 * Page-level Server Component.
 *
 * Next.js App Router passes `{ params }` where `params.id` is the dynamic
 * segment.  We await params so the component is compatible with both the
 * current Next.js 14 sync form and the upcoming async-params API.
 *
 * @param {{ params: Promise<{ id: string }> | { id: string } }} props
 */
export default async function InvoiceDetailPage({ params, searchParams }) {
  // Support both the current (sync object) and future (Promise) params shape.
  const resolvedParams = await Promise.resolve(params);
  const rawId = resolvedParams && typeof resolvedParams === "object" ? resolvedParams.id : undefined;
  const id = normalizeInvoiceId(rawId);

  // Invariant: an invalid id is indistinguishable from a missing one.
  // Rejecting here keeps the state transition deterministic and avoids
  // passing attacker-controlled strings into the data layer.
  if (id === null) {
    notFound();
  }

  const backHref = getMarketplaceHref(normalizeSearchParams(searchParams));

  const invoice = getInvoiceById(id);

  // Invariant: only fully-shaped invoices may render. A malformed record
  // is treated as absent so no partial state leaks into the UI or JSON-LD.
  if (!isRenderableInvoice(invoice)) {
    notFound();
  }

  // Invariant: the resolved invoice id must match the requested id.
  // A mismatch indicates data-layer corruption and must not be rendered.
  if (invoice.id !== id) {
    notFound();
  }

  const invoiceJsonLd = buildInvoiceJsonLd(invoice);
  const detailItems = buildInvoiceDetailItems(invoice);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 print-page-wrapper">
      {/* ── Navigation ────────────────────────────────────────────────── */}
      <header className="no-print border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <Link
          href="/"
          className="inline-block py-3 text-xl font-semibold tracking-tight text-cyan-400 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 rounded"
        >
          {detail.backToHome}
        </Link>
        <NavMenu />
      </header>

      <main id="main-content" className="max-w-4xl mx-auto px-6 py-12">
        <RouteFocus />
        {/* ── JSON-LD structured data ────────────────────────────────── */}
        {invoiceJsonLd ? (
          <script
            type="application/ld+json"
            // JSON.stringify is safe here; sanitizeText already stripped
            // characters that could escape the script context.
            dangerouslySetInnerHTML={{ __html: JSON.stringify(invoiceJsonLd) }}
          />
        ) : null}

        {/* ── Back navigation ───────────────────────────────────────── */}
        <Link
          href={backHref}
          className="no-print inline-block mb-6 text-sm text-slate-400 hover:text-cyan-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 rounded"
          aria-label={detail.backToMarketplaceLabel}
        >
          {detail.backToMarketplace}
        </Link>

        {/* ── Page heading ──────────────────────────────────────────── */}
        <h1 className="text-2xl font-bold mb-2">{detail.pageTitle}</h1>
        <p className="text-slate-400 mb-8">{detail.pageSub}</p>

        {/* ── Invoice metadata (density-aware, client-rendered) ─────── */}
        <InvoiceDetailClient
          summaryHeading={invoice.issuer}
          labelIssuer={detail.labelIssuer}
          labelAmount={detail.labelAmount}
          labelYield={detail.labelYield}
          labelMaturity={detail.labelMaturity}
          labelStatus={detail.labelStatus}
          labelReference={detail.labelReference}
          issuer={invoice.issuer}
          formattedAmount={formatCurrency(invoice.amount, { currency: invoice.currency })}
          formattedYield={formatYield(invoice.yield)}
          dueDate={invoice.dueDate}
          referenceId={invoice.id}
          statusPill={<StatusPill status={invoice.status ?? ""} />}
        />

        {/* ── Detail documents with bulk-select toolbar ─────────────── */}
        <InvoiceDetailItems initialItems={detailItems} />

        {/* ── CSV / JSON export ────────────────────────────────────── */}
        <InvoiceDetailExport invoice={invoice} />

        {/* ── Lifecycle timeline (server-rendered, status-driven) ───────── */}
        <InvoiceTimeline
          status={invoice.status}
          timestamps={invoice.timestamps}
          events={invoice.events}
          className="mb-6"
        />

        {/* ── Interactive controls (client boundary) ────────────────── */}
        <FundActions
          id={invoice.id}
          status={invoice.status}
          maxAmount={invoice.amountValue}
          currency={invoice.currency}
          yieldValue={invoice.yieldValue}
        />
      </main>
    </div>
  );
}
