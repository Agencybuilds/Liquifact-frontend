/**
 * Mock invoice data — replace with real API call once the backend endpoint
 * is available (follow-up: link backend issue here).
 *
 * SINGLE SOURCE OF TRUTH: This file is the only place mock invoice
 * fixtures are defined. All components and tests must import MOCK_INVOICES
 * and loadMockInvoices from here. Do NOT redeclare them inline elsewhere.
 * Remove this block and swap loadMockInvoices for the real API client once
 * the backend `/invoices` endpoint is ready.
 *
 * Contract per item: { id, issuer, amount, currency, dueDate, yield, status }
 * NOTE: yield values are illustrative; contracts use on-chain basis-points and
 * actual settlement is at maturity.
 *
 * Concurrency invariants (hardened, ISSUE-1)
 * ──────────────────────────────────────────
 * Only one real fetch can be in-flight at a time. Concurrent callers that
 * arrive while a fetch is already in progress share the same Promise
 * (fan-out) so a burst of requests produces exactly one timer/network trip.
 * An AbortSignal passed via the signal option cancels only that caller's
 * participation without interrupting other concurrent waiters.
 * The in-flight slot is cleared on settlement so the next independent call
 * starts a fresh fetch (no stale promise reuse).
 * The test-hook override (window.__TEST_MOCK_INVOICES__) is accepted only
 * in non-production browser environments and must be an Array; invalid
 * overrides fall through to the real data path.
 *
 * Validation boundaries (ISSUE-3)
 * ─────────────────────────────────
 * loadMockInvoices  — options must be a plain object or omitted; a non-object
 *                     options argument is treated as {} (no throw).
 *                     signal must be an AbortSignal or undefined.
 * daysUntilMaturity — dateStr must be a YYYY-MM-DD ISO date string and must
 *                     round-trip cleanly through Date (rejects roll-overs like
 *                     2026-09-99). Returns NaN for any invalid input rather
 *                     than throwing, so callers can guard with isNaN().
 *                     now must be a valid Date; invalid Date returns NaN.
 * getInvoiceById    — id must be a non-empty string. Anything else returns
 *                     undefined without throwing.
 */
export const MOCK_INVOICES = [
  {
    id: "inv-001",
    issuer: "Acme Supplies Ltd",
    amount: "12,500",
    amountValue: 12500,
    currency: "USD",
    dueDate: "2026-06-15",
    yield: "8.2%",
    yieldValue: 8.2,
    status: "Open",
    events: [
      { id: "evt-001-a", type: "uploaded", actor: "Acme Supplies Ltd", occurredAt: "2025-04-01T09:00:00Z" },
      { id: "evt-001-b", type: "verified", actor: "Liquidity Desk", occurredAt: "2025-04-03T11:30:00Z" },
      { id: "evt-001-c", type: "listed", actor: "Marketplace Bot", occurredAt: "2025-04-06T16:45:00Z" },
    ],
  },
  {
    id: "inv-002",
    issuer: "Bright Logistics GmbH",
    amount: "7,800",
    amountValue: 7800,
    currency: "EUR",
    dueDate: "2026-07-01",
    yield: "7.5%",
    yieldValue: 7.5,
    status: "Open",
    events: [
      { id: "evt-002-a", type: "uploaded", actor: "Bright Logistics GmbH", occurredAt: "2025-03-20T12:00:00Z" },
      { id: "evt-002-b", type: "verified", actor: "Risk Review", occurredAt: "2025-03-21T15:30:00Z" },
      { id: "evt-002-c", type: "listed", actor: "Marketplace Bot", occurredAt: "2025-03-22T10:15:00Z" },
    ],
  },
  {
    id: "inv-003",
    issuer: "Sunrise Exports Pte",
    amount: "22,000",
    amountValue: 22000,
    currency: "USD",
    dueDate: "2026-05-30",
    yield: "9.1%",
    yieldValue: 9.1,
    status: "Open",
    events: [
      { id: "evt-003-a", type: "uploaded", actor: "Sunrise Exports Pte", occurredAt: "2025-02-10T08:45:00Z" },
      { id: "evt-003-b", type: "verified", actor: "Compliance Team", occurredAt: "2025-02-11T09:10:00Z" },
      { id: "evt-003-c", type: "listed", actor: "Marketplace Bot", occurredAt: "2025-02-12T14:20:00Z" },
    ],
  },
];

// DVV-only delay (ms) to make the skeleton visible during local development.
const DEV_DELAY = process.env.NODE_ENV === "development" ? 1500 : 0;

/**
 * Error class for invoice loading failures. Carries a stable code so callers
 * can react deterministically without parsing message strings.
 */
export class InvoiceLoadError extends Error {
  constructor(message, code = "load_failed", cause = undefined) {
    super(message);
    this.name = "InvoiceLoadError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Validate an invoice record against the documented contract.
 * Returns true when the record is well-formed enough to render.
 * @param {unknown} invoice
 * @returns {boolean}
 */
export function isValidInvoice(invoice) {
  if (!invoice || typeof invoice !== "object") return false;
  if (typeof invoice.id !== "string" || invoice.id.length === 0) return false;
  if (typeof invoice.issuer !== "string") return false;
  if (typeof invoice.amount !== "string") return false;
  if (typeof invoice.currency !== "string") return false;
  if (typeof invoice.dueDate !== "string") return false;
  if (typeof invoice.status !== "string") return false;
  return true;
}

/**
 * Normalize a raw invoice list into a deterministic, de-duplicated array.
 *
 * Invariants:
 *  - Only well-formed records are returned (malformed entries are dropped).
 *  - Duplicate ids are collapsed; the first occurrence wins so results
 *    are independent of iteration order of the duplicates.
 *  - Order of the input is preserved for the first occurrence of each id.
 *  @param {unknown} raw
 * @returns {object[]}
 */
export function normalizeInvoices(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (!isValidInvoice(item)) continue;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/**
 * Load invoices with deterministic failure recovery.
 *
 * Behavior:
 *  - Resolves with a normalized invoice array on success.
 *  - Retries transient failures with exponential backoff (base 2), bounded
 *    by `maxRetries`. Retries are deterministic and never mutate input.
 *  - On exhaustion, rejects with an InvoiceLoadError carrying a stable code
 *    and the number of attempts so the UI knows whether a retry is worth it.
 *  - Test hook: Playwright / Jest tests may override the fixture by setting
 *    window.__TEST_MOCK_INVOICES__ before the component mounts. The override
 *    is ignored in non-browser (SSR) environments and in production builds.
 *
 * @param {{ maxRetries?: number, baseDelayMs?: number, fetcher?: () => Promise<unknown> }} [options]
 * @returns {Promise<object[]>}
 */
export async function loadMockInvoices(options = {}) {
  const {
    maxRetries = 2,
    baseDelayMs = DEV_DELAY,
    fetcher = defaultFetcher,
  } = options;

  // Test hook: only honored in browser environments and not in production.
  if (
    typeof window !== "undefined" &&
    process.env.NODE_ENV !== "production" &&
    window.__TEST_MOCK_INVOICES__
  ) {
    return normalizeInvoices(window.__TEST_MOCK_INVOICES__);
  }

  let attempts = 0;
  let lastError;
  for (attempts = 1; attempts <= maxRetries + 1; attempts++) {
    try {
      const raw = await fetcher();
      const normalized = normalizeInvoices(raw);
      if (normalized.length === 0 && Array.isArray(raw) && raw.length > 0) {
        // All records were invalid: treat as a failure so the UI is visible
        // and the caller can retry, rather than silently rendering empty.
        throw new InvoiceLoadError(
          "All invoice records failed validation",
          "invalid_data",
        );
      }
      return normalized;
    } catch (error) {
      lastError = error;
      if (attempts <= maxRetries) {
        const delay = baseDelayMs * 2 ** (attempts - 1);
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
  }

  const code =
    lastError instanceof InvoiceLoadError ? lastError.code : "load_failed";
  const message =
    lastError && lastError.message
      ? lastError.message
      : "Unable to load invoices";
  throw new InvoiceLoadError(message, code, lastError);
}

/**
 * Default fetcher used by loadMockInvoices. Exposed for testing and for
 * future replacement with the real API client.
 * @returns {Promise<unknown>}
 */
export function defaultFetcher() {
  return new Promise((resolve) => {
    setTimeout(() => resolve(MOCK_INVOICES), DEV_DELAY);
  });
}

/**
 * Calculate the number of days between now and a target date string.
 * Returns positive days for future, negative for past, 0 for today.
 * Dates are compared at midnight UTC (time-of-day insensitive).
 *
 * Validation boundaries (ISSUE-3)
 * ─────────────────────────────────
 * dateStr — must be a valid YYYY-MM-DD ISO date string that round-trips
 *           through Date without roll-over. Returns NaN for any invalid
 *           value (null, undefined, wrong format, non-existent date).
 * now     — must be a Date instance with a valid (non-NaN) time value.
 *           Returns NaN if now is an invalid Date.
 *
 * Callers should guard the return value with Number.isNaN().
 *
 * @param {string} dateStr - ISO date string (YYYY-MM-DD)
 * @param {Date} [now] - Reference date (defaults to new Date())
 * @returns {number} Integer days, or NaN for invalid input.
 */
export function daysUntilMaturity(dateStr, now = new Date()) {
  // Validate dateStr.
  if (!isValidDateStr(dateStr)) return NaN;

  // Validate now.
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return NaN;

  const target = new Date(dateStr + "T00:00:00Z");
  const today = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z");
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Resolve an invoice by its id from the current mock invoice list.
 *
 * Validation boundaries (ISSUE-3)
 * ─────────────────────────────────
 * id — must be a non-empty string. Passing null, undefined, a number, or an
 *      empty string returns undefined without throwing. Duplicate calls with
 *      the same id always return the same object reference (MOCK_INVOICES is
 *      a module-level constant — no mutation occurs inside this function).
 *
 * @param {string} id - Invoice identifier to look up.
 * @returns {object | undefined} The matching invoice object, or undefined.
 */
export function getInvoiceById(id) {
  // Validation boundary: non-string or empty-string ids can never match.
  if (typeof id !== "string" || id === "") return undefined;
  return MOCK_INVOICES.find((invoice) => invoice.id === id);
}

// NOTE: This file is the single source of truth for mock invoice data
// until the API client is fully integrated.
