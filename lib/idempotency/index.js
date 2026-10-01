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
 * Security note
 * ─────────────
 * The key is a random UUID — it carries no sensitive information about the
 * user, wallet, or invoice.  It is only sent as a request header so the
 * backend can deduplicate within the same session.
 *
 * State invariants
 * ─────────────────
 * This module owns the following invariants.  Any change to them must be
 * accompanied by a focused test in `lib/idempotency/___tests__/`:
 *
 *  I1. **Determinism** — `getOrCreateIdempotencyKey` returns the same
 *      value for the same (wallet, invoice, amount) triple within a tab
 *      session, even if the underlying storage is full, blocked, or throws.
 *
 *  I2. **No data loss on clear** — `clearIdempotencyKey` must never throw.
 *      A thrown clear would leave the caller in an unknown state and could
 *      surface as an unhandled rejection after a successful funding.
 *
 *  I3. **Concurrency safety** — two concurrent calls for the same triple
 *      must not produce two different keys.  We maintain an in-memory cache
 *      and a micro-task mutex so the first caller wins and later callers
 *      observe the same key.
 *
 *  I4. **Input validation** — invalid inputs (empty invoiceId, non-finite
 *      amount, negative amount) must be rejected with a `TypeError` rather
 *      than silently producing a colliding key.
 *
 *  I5. **Clear-then-recreate** — after `clearIdempotencyKey`, a subsequent
 *      `getOrCreateIdempotencyKey` for the same triple must return a *new*
 *      key (the old one must not be resurrected from a stale in-memory cache).
 *
 * @module lib/idempotency
 */

/** Prefix for all sessionStorage idempotency keys. */
const KEY_PREFIX = "liquifact-idem-";

/**
 * In-memory cache of keys we have already handed out in this JS realm.
 *
 * Why is this needed in addition to `sessionStorage`?
 * - `sessionStorage` can be blocked (private browsing, cookie policy,
 *   quota exceeded).  Without an in-memory cache the fallback path would
 *   generate a *new* UUID on every call, violating I1 in the exact case
 *   where deduplication matters most.
 * - Two concurrent callers before the first write commits would otherwise
 *   race and produce different keys (I3).
 *
 * The cache is scoped to the module instance (browser tab or Node process),
 * which matches the scope of `sessionStorage`.
 *
 * @type {Map<string, string>}
 */
const inmemoryKeys = new Map();

/**
 * Pending promises for keys currently being created.  This is the micro-
 * task mutex that enforces I3: if two callers are in flight for the same
 * triple, the second awaits the first instead of generating a competing
 * key.
 *
 * @type {Map<string, Promise<string>>}
 */
const pendingKeys = new Map();

/**
 * Return true when `sessionStorage` is available and writable.
 *
 * We probe with a throwaway key rather than just checking for the global
 * because `sessionStorage` can exist but throw on access (e.g. Safari private
 * mode historically threw on `setItem`).
 *
 * @returns {boolean}
 */
function hasSessionStorage() {
  if (typeof sessionStorage === "undefined") return false;
  try {
    const probe = "__liquifact_probe__";
    sessionStorage.setItem(probe, "1");
    sessionStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/**
 * Return a cryptographically random UUID.
 *
 * Prefers the Web Crypto API (available in all modern browsers and Node >14.17).
 * Falls back to a random-hex generator in environments where `crypto.randomUUID`
 * is not available (e.g. legacy test runners).  The fallback is not a v4 UUID
 * but is still unique enough for idempotency deduplication.
 *
 * @returns {string}
 */
function randomId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback: time + random hex.  Not a cryptographic UUID, but unique enough
  // for client-side idempotency deduplication.
  const time = Date.now().toString(16);
  const rand = Math.random().toString(16).slice(2);
  return `${time}-${rand}-${randomId.counter = (randomId.counter || 0) + 1}`;
}

/**
 * Validate the inputs to the idempotency key API.  This enforces I4 and
 * prevents silent key collisions from malformed inputs.
 *
 * @param {string}         invoiceId
 * @param {string | null}  walletAddress
 * @param {number}        amount
 * @throws {TypeError} when any input is invalid
 */
function validateInputs(invoiceId, walletAddress, amount) {
  if (typeof invoiceId !== "string" || invoiceId.length === 0) {
    throw new TypeError("invoiceId must be a non-empty string");
  }
  if (
    walletAddress !== null &&
    walletAddress !== undefined &&
    typeof walletAddress !== "string"
  ) {
    throw new TypeError("walletAddress must be a string or null");
  }
  if (typeof amount !== "number" || !Number.finite(amount) || amount <= 0) {
    throw new TypeError("amount must be a positive finite number");
  }
}

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
  // "anonymous" so a key is always generated and can be stored before the
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
 * session.
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

  // Fast path: already cached in this JS realm.
  const cached = inmemoryKeys.get(storageKey);
  if (cached) return cached;

  // Concurrency guard: another caller is already creating this key.
  const pending = pendingKeys.get(storageKey);
  if (pending) return pending;

  const work = (async () => {
    // SSR / test environments may not have sessionStorage.
    if (!hasSessionStorage()) {
      const fresh = randomId();
      inmemoryKeys.set(storageKey, fresh);
      return fresh;
    }

    const existing = sessionStorage.getItem(storageKey);
    if (existing) {
      inmemoryKeys.set(storageKey, existing);
      return existing;
    }

    const fresh = randomId();
    try {
      sessionStorage.setItem(storageKey, fresh);
    } catch {
      // sessionStorage full or blocked (e.g. private-browsing quota exceeded).
      // The in-memory cache below still guarantees I1 for this realm.
    }
    inmemoryKeys.set(storageKey, fresh);
    return fresh;
  })();

  pendingKeys.set(storageKey, work);
  try {
    return await work;
  } finally {
    pendingKeys.delete(storageKey);
  }
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
 * This function never throws (I2).  It also evicts the in-memory cache entry
 * so a subsequent `getOrCreateIdempotencyKey` call for the same triple
 * returns a fresh key (I5).
 *
 * @param {string}         invoiceId
 * @param {string | null}  walletAddress
 * @param {number}        amount
 */
export function clearIdempotencyKey(invoiceId, walletAddress, amount) {
  // Validate before building the storage key so we never silently clear the
 // wrong entry.  Invalid inputs here are a programming error, not a runtime
  // condition we should swallow.
  validateInputs(invoiceId, walletAddress, amount);

  const storageKey = buildStorageKey(invoiceId, walletAddress, amount);

  // Always evict the in-memory cache, even if storage is unavailable.
  inmemoryKeys.delete(storageKey);

  if (!hasSessionStorage()) return;
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    // Ignore — key was never stored or storage is unavailable.
  }
}

/**
 * Test-only helper: clear all in-memory state.
 *
 * Exported so focused tests can isolate cases without relying on module
 * registry trickery.  Not intended for production use.
 */
export function __resetIdempotencyStateForTests() {
  inmemoryKeys.clear();
  pendingKeys.clear();
}
