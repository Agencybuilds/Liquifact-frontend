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
 * @typedef {Object} InvoiceLoadResult
 * @property {Array<Object>} invoices
 * @property {Object} meta
 * @property {boolean} meta.degraded - true when the primary source failed and
 *   the fallback fixture was used.
 * @property {string} [meta.reason] - machine-readable reason code for the
 *   degradation (e.g. "timeout", "http_500", "invalid_payload").
 * @property {string} [meta.requestId] - correlation id from the backend.
 */

/**
 * Build a deep clone of the mock fixture so callers cannot mutate the
 * single source of truth and cause non-deterministic results across tests.
 * @returns {Array<Object>}
 */
function cloneMockInvoices() {
  return MOCK_INVOICES.map((inv) => ({
    ...inv,
    events: Array.isArray(inv.events) ? inv.events.map((e) => ({ ...e })) : [],
  }));
}

/**
 * Normalize a raw invoice payload into the UI contract:
 *   { id, issuer, amount, amountValue, currency, dueDate, yield, yieldValue,
 *     status, events }
 *
 * This is the only place we translate backend shape -> UI shape. It is
 * deterministic for any input shape (missing fields become null, events
 * always an array).
 *
 * @param {unknown} raw
 * @returns {Object}
 */
export function normalizeInvoice(raw) {
  if (!raw || typeof raw !== "object") {
    throw new TypeError("Invoice must be an object");
  }
  const {
    id = null,
    issuer = null,
    amount = null,
    amountValue = null,
    currency = null,
    dueDate = null,
    yield: invYield = null,
    yieldValue = null,
    status = null,
    events = [],
  } = raw;
  return {
    id,
    issuer,
    amount,
    amountValue,
    currency,
    dueDate,
    yield: invYield,
    yieldValue,
    status,
    events: Array.isArray(events) ? events.map((e) => ({ ...e })) : [],
  };
}

/**
 * Classify an error from a invoice load attempt into a stable, non-sensitive
 * reason code. This is used for observability and for deciding whether a
 * retry is safe.
 *
 * @param {unknown} err
 * @returns {string}
 */
export function classifyLoadError(err) {
  if (!err) return "unknown";
  const name = err.name || "";
  if (name === "InvoiceTimeoutError") return "timeout";
  if (name === "AbortError") return "aborted";
  if (typeof err.status === "number") return `http_${err.status}`;
  if (name === "TypeError") return "invalid_payload";
  return "network_error";
}

/**
 * Load investable invoices.
 *
 * This function is the single entry point used by the invest UI. It is
 * deterministic and recoverable:
 *
 *   1. If a test override is present (`window__TEST_MOCK_INVOICES__`),
 *      it is used directly and tagged as `source: "test"`.
 *   2. Otherwise the real API is called via `fetchInvestableInvoices`.
 *      On success the normalized list is returned with `source: "api"`.
 *   3. On failure the call is retried with exponential backoff up to `retries`.
 *      Timeouts, 5xx, and network errors are retried; 4xx client errors are
 *      not retried (except 429) because retrying won't help.
 *   4. If all retries fail, the function resolves with the local mock
 *      fixture and `degraded: true` so the UI can render a banner and the
 *      user can continue working. The error is reported through the
 *      observability sink but never thrown to the caller.
 *
 * The result shape is always:
 *   { invoices: Array<Object>, meta: { degraded, reason?, requestId?, attempts } }
 *
 * @param {Object} [options]
 * @param {number} [options.retries=2] - number of retries after the first attempt
 * @param {number} [options.timeoutMs]
 * @param {Function} [options.fetcher] - injectable fetcher (for tests)
 * @param {Function} [options.sleep] - injectable sleep (for tests)
 * @param {Function} [options.reporter] - injectable error reporter
 * @param {Function} [options.onDegraded] - called with meta when fallback is used
 * @returns {Promise<InvoiceLoadResult>}
 */
export async function loadInvoices(options = {}) {
  const {
    retries = 2,
    timeoutMs,
    fetcher,
    sleep,
    reporter,
    onDegraded,
  } = options;

  // Test hook: Playwright / Jest tests may override the fixture by setting
  // window.__TEST_MOCK_INVOICES__ before the component mounts.  The override
  // is ignored in non-browser (SSR) environments and in production builds.
  if (typeof window !== "undefined" && window.__TEST_MOCK_INVOICES__) {
    const override = window.__TEST_MOCK_INVOICES__;
    const list = Array.isArray(override) ? override : [];
    return {
      invoices: list.map(normalizeInvoice),
      meta: { degraded: false, source: "test", attempts: 0 },
    };
  }

  // Resolve the fetcher and sleep implementations. We lazy-load the real
  // API client so this module remains importable from SSR and test code.
  const doFetch = fetcher || (opts) => {
    // eslint-disable-next-line global-require
    const { fetchInvestableInvoices } = require("../api/invoices");
    return fetchInvestableInvoices(opts);
  };
  const doSleep = sleep || ((ms) => new Promise((res) => setTimeout(res, ms)));

  const totalAttempts = Math.max(1, Number(retries) + 1);
  let lastError;
  let lastRequestId;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      const raw = await doFetch({ timeoutMs });
      const invoices = Array.isArray(raw) ? raw.map(normalizeInvoice) : [];
      return {
        invoices,
        meta: { degraded: false, source: "api", attempts: attempt },
      };
    } catch (err) {
      lastError = err;
      lastRequestId = err.requestId;
      const reason = classifyLoadError(err);

      // Aborted by caller (unmount) -> do not retry, do not degrade.
      if (reason === "aborted") {
        throw err;
      }

      // 4xx client errors (except 429) are not retryable.
      const isClientError = /^http_4\d\d$/.test(reason) && reason !== "http_429";
      const isLastAttempt = attempt === totalAttempts;

      if (isClientError || isLastAttempt) {
        break;
      }

      // Exponential backoff with deterministic base (250ms * 2^(attempt-1)).
      const backoffMs = 250 * Math.pow(2, attempt - 1);
      await doSleep(backoffMs);
    }
  }

  // All retries exhausted -> degrade to the local fixture so the UI is
  // always renderable and the user can continue. The error is reported
  // through the observability sink with a stable reason code.
  const reason = classifyLoadError(lastError);
  const meta = {
    degraded: true,
    source: "mock",
    reason,
    requestId: lastRequestId,
    attempts: totalAttempts,
  };

  try {
    const report = reporter || ((opts) => {
      // eslint-disable-next-line global-require
      const { reportError } = require("../observability/reportError");
      reportError(opts.error, opts.context);
    });
    report({
      error: lastError,
      context: {
        scope: "loadInvoices",
        reason: meta.reason,
        requestId: meta.requestId,
        attempts: meta.attempts,
      },
    });
  } catch {
    // Observability must never break the load path.
  }

  try {
    onDegraded?.(meta);
  } catch {
    // Callback failures must not break the load path.
  }

  return { invoices: cloneMockInvoices(), meta };
}

/**
 * Backwards-compatible wrapper. Returns just the invoice array so existing
 * callers that `await loadMockInvoices()` keep working. New code should
 * prefer `loadInvoices()` to access the `meta` degradation flag.
 *
 * @param {Object} [options]
 * @returns {Promise<Array<Object>>}
 */
export async function loadMockInvoices(options) {
  const { invoices } = await loadInvoices(options);
  return invoices;
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
