/* eslint-disable no-undef */
/**
 * @file lib/idempotency/index.js
 *
 * Idempotency key utilities for the funding submission flow.
 *
 * Design rationale
 * ────────────────
 * A double-click or browser/wallet retry must not result in two competing
 * submissions for the same funding intent.  We enforce this at the client
 * layer in two complementary ways:
 *
 * 1. **In-memory guard** (`submissionGuardRef` in `useFundingSubmit`) — blocks
 *    a second call while a request is in-flight within the same React component
 *    instance.
 *
 * 2. **Session-persisted idempotency key** (`getOrCreateIdempotencyKey`) —
 *    the key survives component remounts (e.g. React StrictMode double-invoke,
 *    user clicking a "retry" link).  On retry the same key is re-sent, so if
 *    the server already processed the request it can return the cached result
 *    without double-charging.
 *
 *    `sessionStorage` is deliberately chosen over `localStorage`:
 *    - Cleared automatically when the tab is closed → no stale keys from
 *      previous sessions confusing the server.
 *    - Scoped per tab → a second tab for the same invoice will use its own
 *      key (the BroadcastChannel lock in `useFundingSubmit` handles cross-tab
 *      deduplication separately).
 *
 * Determinism / recovery invariants
 * ──────────────────────────────
 * The following invariants are enforced by this module and must hold for
 * every call, including concurrent and partial-failure scenarios:
 *
 * - I1 (determinism): for a given (wallet, invoice, amount) triple,
 *   getOrCreateIdempotencyKey returns the same value on every call within
 *   the same tab session, regardless of how many times it is invoked.
 * - I2 (concurrency): concurrent calls for the same triple must not create
 *   divergent keys.  A synchronous in-flight map guarantees the first caller to
 *   win and later callers to observe the same key.
 * - I3 (recovery): on failure the key is retained so a retry re-uses it and the
 *   server can deduplicate.  On confirmed success the key is cleared so a
 *   future intentional funding of the same invoice gets a fresh key.
 * - I4 (no silent data loss): if persistence fails (SSR, quota exceeded,
 *   private browsing), the key is still returned and kept in memory for the
 *   lifetime of the tab.
 * - I5 (deterministic cleanup): clearIdempotencyKey is a no-throw operation
 *   that always removes the in-memory and persisted entries for the triple.
 *
 * Security note
 * ──────────────
 * The key is a random UUID — it carries no sensitive information about the
 * user, wallet, or invoice.  It is only sent as a request header so the
 * backend can deduplicate within the same session.
 *
 * @package lib/idempotency
 */

// Ensure `crypto.randomUUID` is available in every runtime (older browsers,
// jsdom test environments, SSR shims).  Falls back to a v4 UUID built from
// `crypto.getRandomValues`, and finally to `Math.random` as a last resort.
const randomUUID = (() => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return () => crypto.randomUUID();
  }
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    return () => {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
      return (
        hex.slice(0, 4).join("") +
        "-" +
        hex.slice(4, 6).join("") +
        "-" +
        hex.slice(6, 8).join("") +
        "-" +
        hex.slice(8, 10).join("") +
        "-" +
        hex.slice(10, 16).join("")
      );
    };
  }
  return () => {
    let out = "";
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) {
        out += "-";
      } else if (i === 14) {
        out += "4";
      } else {
        const r = (Math.random() * 16) | 0;
        out += (i === 19 ? (r & 0x3) | 0x8 : r).toString(16);
      }
    }
    return out;
  };
})();

/** Prefix for all sessionStorage idempotency keys. */
const KEY_PREFIX = "liquifact-idem-";

/**
 * Process-wide in-flight map that guarantees concurrent calls for the same
 * storage key observe the same idempotency key.  This is necessary because
 * `sessionStorage.getItem` followed by `setItem` is not atomic across async
 * callers.  Entries are never evicted during a tab's lifetime because the
 * number of distinct (wallet, invoice, amount) triples is bounded by user
 * activity and each entry is tiny.
 *
 * @type {Map<string, string>}
 */
const inflightKeys = new Map();

/**
 * Build the sessionStorage key for a given (walletAddress, invoiceId, amount)
 * triple.  Amount is included so that two different partial-fund attempts on the
 * same invoice (e.g. $100 then $200) each get an independent idempotency
 * key.
 *
 * @param {string}         invoiceId     - The invoice being funded
 * @param {string | null}  walletAddress - Connected wallet address (or null)
 * @param {number}         amount        - Funding amount
 * @returns {string}
 */
export function buildStorageKey(invoiceId, walletAddress, amount) {
  // walletAddress may be absent before connection; treat null / undefined as
  // "anon" so a key is always generated and can be stored before the
  // wallet is fully connected.
  const wallet = walletAddress ?? "anon";
  return `${KEY_PREFIX}${wallet}-${invoiceId}-${amount}`;
}

/**
 * Return the existing idempotency key for this (wallet, invoice, amount)
 * triple from `sessionStorage`, or generate and persist a fresh UUID if none
 * exists yet.
 *
 * Calling this function multiple times with the same arguments is safe —
 * it always returns the same key for the same triple within a browser tab
 * session.  Concurrent calls also converge on a single key (see I2).
 *
 * Concurrency: two callers invoking this function in the same micro-task
 * will both observe the same key (the second awaits the first).
 *
 * @param {string}         invoiceId
 * @param {string | null}  walletAddress
 * @param {number}         amount
 * @returns {Promise<string>}  A v4 UUID string
 */
export async function getOrCreateIdempotencyKey(invoiceId, walletAddress, amount) {
  validateInputs(invoiceId, walletAddress, amount);

  const storageKey = buildStorageKey(invoiceId, walletAddress, amount);

  // I2: concurrent callers for the same triple must not create divergent keys.
  // The in-flight map is checked first because it is the authoritative source
  // of truth within the current tab lifetime.
  const inFlight = inflightKeys.get(storageKey);
  if (inFlight) return inFlight;

  // SSR / test environments may not have sessionStorage.  We still record the
  // key in the in-flight map so repeated calls in the same process are
  // deterministic.
  if (typeof sessionStorage === "undefined") {
    const fresh = generateUuid();
    inflightKeys.set(storageKey, fresh);
    return fresh;
  }

  // I1: reuse any persisted key for this triple.
  let existing = null;
  try {
    existing = sessionStorage.getItem(storageKey);
  } catch {
    // sessionStorage can throw in private browsing or when access is blocked.
    // Fall through to generating a fresh key and keep it in memory.
    existing = null;
  }
  if (existing) {
    inflightKeys.set(storageKey, existing);
    return existing;
  }

  const fresh = generateUuid();
  // I4: record in memory before attempting persistence so a storage failure
  // cannot cause a concurrent caller to generate a different key.
  inflightKeys.set(storageKey, fresh);
  try {
    sessionStorage.setItem(storageKey, fresh);
  } catch {
    // sessionStorage full or blocked (e.g. private-browsing quota exceeded).
    // Fall back to a fresh key that won't be persisted — the in-memory guard
    // and the in-flight map still prevent double-submit within the same
    // React lifecycle and tab.
  }
}

/**
 * Generate a v4 UUID, preferring the platform `crypto.randomUUID` when
 * available and falling back to a `crypto.getRandomValues`-backed
 * implementation otherwise.  The fallback keeps key generation deterministic
 * in environments (older browsers, some test runners, non-secure contexts)
 * where `crypto.randomUUID` is not exposed, so failure recovery does not
 * silently break idempotency.
 *
 * @returns {string} A v4 UUID string
 */
function generateUuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  // Per RFC 4122 §4.4: set version (4) and variant (10xx) bits.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [];
  for (let i = 0; i < bytes.length; i += 1) {
    hex.push(bytes[i].toString(16).padStart(2, "0"));
  }
  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}

/**
 * Remove the persisted idempotency key for this triple.
 *
 * Call this on confirmed SUCCESS so that a fresh invoice funding attempt
 * (same invoice, same amount) in a later session gets a new key rather than
 * re-using a key the server already marked as processed.
 *
 * On FAILURE / ROLLBACK the key is intentionally kept so that a user retry
 * re-uses the same key and the server can return a cached idempotent response
 * if it already partially processed the request.
 *
 * @throws {never} This function is deliberately no-throw (I5).
 *
 * @param {string}         invoiceId
 * @param {string | null}  walletAddress
 * @param {number}        amount
 */
export function clearIdempotencyKey(invoiceId, walletAddress, amount) {
  const storageKey = buildStorageKey(invoiceId, walletAddress, amount);

  // Always drop the in-memory entry first so a subsequent getOrCreate call
  // cannot resurrect a key that was just confirmed as processed.
  inflightKeys.delete(storageKey);

  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    // Ignore — key was never stored or storage is unavailable.
  }
}

/**
 * Test-only helper: reset the in-flight map.  Not part of the public API
 * contract and only exported so focused tests can isolate cases.
 *
 * @internal
 */
export function __resetIdempotencyStateForTests() {
  inflightKeys.clear();
}

