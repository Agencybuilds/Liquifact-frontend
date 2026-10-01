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
 * NOTE: yield values are illustrative; contracts use on-chain basis points and
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

// DEV-only delay (ms) to make the skeleton visible during local development.
const DEV_DELAY = process.env.NODE_ENV === "development" ? 1500 : 0;

// ── In-flight deduplication slot ──────────────────────────────────────────────
// Invariant: null when idle, a pending Promise when a fetch is in progress.
// Never replaced mid-flight — set to null only on settlement so callers always
// receive fresh data on the next independent call.
let _inflight = null;

/**
 * Resolve the test-hook override when in a valid non-production browser env.
 * Returns the override array when valid, or null to fall through.
 * @returns {Array|null}
 */
function getTestOverride() {
  if (
    typeof window === "undefined" ||
    process.env.NODE_ENV === "production"
  ) {
    return null;
  }
  const override = window.__TEST_MOCK_INVOICES__;
  // Must be an Array; non-array values (strings, booleans, etc.) are ignored.
  if (!Array.isArray(override)) return null;
  return override;
}

/**
 * Validate that str is a YYYY-MM-DD ISO date string that round-trips cleanly
 * through Date (rejects calendar roll-overs like 2026-09-99).
 *
 * This is the boundary check shared by daysUntilMaturity (ISSUE-3).
 *
 * @param {unknown} str
 * @returns {boolean}
 */
export function isValidDateStr(str) {
  if (typeof str !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(str + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return false;
  // Reject roll-overs: new Date('2026-09-99') silently rolls to a valid date
  // in some engines, so we verify the round-trip.
  return d.toISOString().slice(0, 10) === str;
}

/**
 * Load mock invoices, deduplicated across concurrent callers.
 *
 * Test hook: Playwright / Jest tests may override the fixture by setting
 * window.__TEST_MOCK_INVOICES__ before the component mounts.  The override
 * is ignored in SSR environments and in production builds, and must be an
 * Array (empty arrays are valid "no invoices" fixtures).
 *
 * Validation boundaries
 * ─────────────────────
 * options — must be a plain object or omitted. A non-object argument is
 *           silently treated as {} so callers never throw on bad input.
 * signal  — must be an AbortSignal instance or undefined/null.
 *           A non-AbortSignal truthy value is ignored (treated as absent).
 *
 * @param {object}      [options]
 * @param {AbortSignal} [options.signal] - When aborted, this caller's promise
 *   rejects with an AbortError. Other concurrent waiters are unaffected.
 *
 * @returns {Promise<Array>} Resolves with the invoice array.
 */
export function loadMockInvoices(options = {}) {
  // Validation boundary: coerce non-object options to {} rather than throwing.
  const safeOptions =
    options !== null && typeof options === "object" && !Array.isArray(options)
      ? options
      : {};

  // Validation boundary: accept only genuine AbortSignal instances.
  const rawSignal = safeOptions.signal;
  const signal =
    typeof AbortSignal !== "undefined" && rawSignal instanceof AbortSignal
      ? rawSignal
      : null;

  // Fast-path: already aborted before we start.
  if (signal?.aborted) {
    return Promise.reject(
      Object.assign(new DOMException("Load aborted", "AbortError"), { code: 20 })
    );
  }

  // Test-hook path: bypass deduplication for deterministic fixtures.
  const testOverride = getTestOverride();
  if (testOverride !== null) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.debug("[invest/lib] loadMockInvoices: test override (" + testOverride.length + " invoices)");
    }
    return Promise.resolve(testOverride);
  }

  // Attach to an existing in-flight fetch or start a new one.
  if (!_inflight) {
    _inflight = new Promise((resolve) => {
      setTimeout(() => {
        _inflight = null; // clear slot before resolving so next call is fresh
        if (process.env.NODE_ENV !== "production") {
          // eslint-disable-next-line no-console
          console.debug("[invest/lib] loadMockInvoices: resolved " + MOCK_INVOICES.length + " invoices");
        }
        resolve(MOCK_INVOICES);
      }, DEV_DELAY);
    });
  }

  // No AbortSignal — return the shared promise directly.
  if (!signal) {
    return _inflight;
  }

  // AbortSignal path: race the shared fetch against this caller's abort.
  // Wrapping in a new Promise keeps _inflight intact for other waiters.
  return new Promise((resolve, reject) => {
    function onAbort() {
      signal.removeEventListener("abort", onAbort);
      reject(
        Object.assign(new DOMException("Load aborted", "AbortError"), { code: 20 })
      );
    }

    if (signal.aborted) {
      onAbort();
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });

    _inflight.then(
      (data) => {
        signal.removeEventListener("abort", onAbort);
        resolve(data);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      }
    );
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
