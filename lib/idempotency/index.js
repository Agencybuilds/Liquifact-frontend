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
 * @fileoverview
 * @module lib/idempotency
 */

/** Prefix for all sessionStorage idempotency keys. */
const KEY_PREFIX = "liquifact-idem-";

/**
 * Build the sessionStorage key for a given (walletAddress, invoiceId, amount)
 * triple.  Amount is included so that two different partial-fund attempts on
 * the same invoice (e.g. $100 then $200) each get an independent idempotency
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
 * Concurrency / idempotency invariant
 * ──────────────────────────────
 * Two concurrent calls for the same triple must not each generate and
 * persist a different key.  The classic "get then set" pattern has a TOU-TOU
 * race: both callers read `null`, both generate a UUID, and the last writer
 * wins.  To close this we use a per-triple in-memory promise lock that
 * serializes concurrent callers within the same JS realm.  The first caller
 * owns the generation + persistence; every other caller awaits the same
 * promise and receives the identical key.
 *
 * The lkey is released once the key has been resolved (or on failure), so
 * the map cannot grow unbounded across a long-lived tab.
 *
 * @param {string}         invoiceId
 * @param {string | null}  walletAddress
 * @param {number}         amount
 * @returns {Promise<string> | string}  A v4 UUID string (or a promise resolving to one)
 */

/** @type {Map<string, Promise<string>>} */
const inFlight = new Map();

function safeRandomUUID() {
  // Prefer the platform crypto.randomUUID when available.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID (older browsers,
  // some test runners).  Uses crypto.getRandomValues when available,
  // otherwise Math.random as a last resort.  The key only needs to be
  // unique within a session, not cryptographically strong.
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // RFC 4122 v4 UUID formatting.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [];
  for (let i = 0; i < bytes.length; i++) hex.push(bytes[i].toString(16).padStart(2, "0"));
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

export function getOrCreateIdempotencyKey(invoiceId, walletAddress, amount) {
  const storageKey = buildStorageKey(invoiceId, walletAddress, amount);

  // SSR / test environments may not have sessionStorage.  In that case there
  // is nothing to persist across remounts, so a fresh key is the only
  // correct answer.
  if (typeof sessionStorage === "undefined") {
    return safeRandomUUID();
  }

  // Fast path: a key already exists in storage.
  const existing = sessionStorage.getItem(storageKey);
  if (existing) return existing;

  // Slow path: deduplicate concurrent callers via a shared in-flight
  // promise.  Without this, two callers can both observe `null`, both
  // generate a UUID, and the last write wins -- leaving one caller holding
  // a key that was never persisted.
  const inFlightPromise = inFlight.get(storageKey);
  if (inFlightPromise) return inFlightPromise;

  const promise = Promise.resolve().then(() => {
    // Re-check inside the microtask in case another caller already
    // persisted a key while we were waiting.
    const recheck = sessionStorage.getItem(storageKey);
    if (recheck) return recheck;

    const fresh = safeRandomUUID();
    try {
      sessionStorage.setItem(storageKey, fresh);
    } catch {
      // sessionStorage full or blocked (e.g. private-browsing quota
      // exceeded).  Fall back to a fresh key that won't be persisted --
      // the in-memory guard still prevents double-submit within the
      // same React lifecycle.
    }
    return fresh;
  });

  inFlight.set(storageKey, promise);

  // Release the lock once the promise settles.  We do not await the
  // release here -- callers receive the promise and can await it
  // independently.
  promise.then(
    () => {
      if (inFlight.get(storageKey) === promise) {
        inFlight.delete(storageKey);
      }
    },
    () => {
      if (inFlight.get(storageKey) === promise) {
        inFlight.delete(storageKey);
      }
    }
  );

  return promise;
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
 * Concurrency / idempotency invariant
 * ──────────────────────────────
 * Clearing is idempotent: calling it multiple times is safe, and a clear
 * that races with an in-flight `getOrCreateIdempotencyKey` cannot result in
 * a stale key being returned to a later caller.  We await any in-flight
 * promise for the same triple before deleting, so the delete always observes
 * the final persisted value.
 *
 * @param {string}         invoiceId
 * @param {string | null}  walletAddress
 * @param {number}        amount
 */
export function clearIdempotencyKey(invoiceId, walletAddress, amount) {
  if (typeof sessionStorage === "undefined") return;
  const storageKey = buildStorageKey(invoiceId, walletAddress, amount);

  const deleteKey = () => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // Ignore -- key was never stored or storage is unavailable.
    }
  };

  // If a generation is in flight for this triple, wait for it to settle
  // before deleting.  Otherwise the in-flight write could land after our
  // delete and resurrect a key the caller believed was gone.
  const inFlightPromise = inFlight.get(storageKey);
  if (inFlightPromise) {
    inFlightPromise.then(deleteKey, deleteKey);
    return;
  }

  deleteKey();
}
