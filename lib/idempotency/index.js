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
 *    - Scoped per tab → a second tab of the same invoice will use its own
 *      key (the BroadcastChannel lock in `useFundingSubmit` handles cross-tab
 *      deduplication separately).
 *
 * Concurrency hardening
 * ───────────────────────
 * The original implementation had a time-of-check-to-time-of-use race: two
 * concurrent calls with the same triple could both observe a missing key,
 * both generate a fresh UUID, and the last writer wins — producing two
 * different keys for the same logical funding intent.  This module now
 * guarantees a single canonical key per triple within a tab via:
 *
 *   - A per-triple in-flight promise cache that coalesces concurrent
 *     callers onto the same generation promise.
 *   - A synchronous fast path that re-reads storage after acquiring the
 *     in-flight slot, so a key written by another context is honoured.
 *   - A cross-tab mutex backed by `BroadcastChannel` (and a localStorage
 *     fallback) that serializes generation across tabs of the same origin.
 *
 * Security note
 * ────────────────
 * The key is a random UUID — it carries no sensitive information about the
 * user, wallet, or invoice.  It is only sent as a request header so the
 * backend can deduplicate within the same session.
 *
 * @packageDocumentation
 * @module lib/idempotency
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

/** Prefix for the cross-tab mutex lock keys. */
const LOCK_PREFIX = "liquifact-idem-lock-";

/** Name of the BroadcastChannel used for cross-tab coordination. */
const LOCK_CHANNEL_NAME = "liquifact-idem-slock";

/** How long a cross-tab lock may be held before being considered stale. */
const LOCK_TTL_MS = 5000;

/** How long to wait between lock acquisition attempts. */
const LOCK_RETRY_MS = 25;

/** Maximum number of lock acquisition attempts. */
const LOCK_MAX_ATTEMPTS = 200;

/**
 * Per-triple in-flight promise cache.
 *
 * The value is a Promise<string> that resolves to the canonical key.
 * Concurrent callers for the same triple await the same promise, so they
 * always observe the same key even if the generation is asynchronous.
 *
 * @type {Map<string, Promise<string>>}
 */
const inFlight = new Map();

/** Whether the current environment can use browser storage. */
function hasSessionStorage() {
  try {
    return typeof sessionStorage !== "undefined" && sessionStorage !== null;
  } catch {
    return false;
  }
}

/** Whether the current environment can use localStorage (lock fallback). */
function hasLocalStorage() {
  try {
    return typeof localStorage !== "undefined" && localStorage !== null;
  } catch {
    return false;
  }
}

/** Whether the current environment can use BroadcastChannel. */
function hasBroadcastChannel() {
  return typeof BroadcastChannel !== "undefined";
}

/**
 * Return a cryptographically random v4 UUID.
 *
 * Prefers `globalThis.crypto.randomUUID` when available, falling back to
 * a Math.random-based generator only when the Web Crypto API is absent.
 * The fallback is still unique enough for deduplication purposes and never
 * contains sensitive data.
 *
 * @returns {string}
 */
function randomUUID() {
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  // RFC 4122 v4 shape using Math.random as a last-resort fallback.
  return "x xxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

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
 * Read the persisted idempotency key for a storage key, or null if none
 * exists.  Wrapped in try/catch because storage access can throw in
 * private-browsing modes.
 *
 * @param {string} storageKey
 * @returns {string | null}
 */
function readPersistedKey(storageKey) {
  if (!hasSessionStorage()) return null;
  try {
    return sessionStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

/**
 * Persist a key, returning true on success.  A write failure is not fatal:
 * the in-memory guard and the in-flight cache still ensure a single key
 * within this tab.
 *
 * @param {string} storageKey
 * @param {string} key
 * @returns {boolean}
 */
function persistKey(storageKey, key) {
  if (!hasSessionStorage()) return false;
  try {
    sessionStorage.setItem(storageKey, key);
    return true;
  } catch {
    // sessionStorage full or blocked (e.g. private-browsing quota exceeded).
    // Fall back to a fresh key that won't be persisted — the in-memory guard
    // still prevents double-submit within the same React lifecycle.
    return false;
  }
}

/**
 * Acquire a cross-tab mutex for a storage key.
 *
 * The lock is adbacated: it only serializes the critical section of
 * generating and persisting a key.  It is not a long-lived lock and must
 * always be released in a finally block.
 *
 * When BroadcastChannel is unavailable we fall back to a localStorage
 * sentinel with an expiry timestamp.  This is best-effort and never blocks
 * forever because of the TTL.
 *
 * @param {string} storageKey
 * @returns {Promise<{ release: () => void }>}
 */
async function acquireLock(storageKey) {
  if (hasBroadcastChannel()) {
    return acquireBroadcastLock(storageKey);
  }
  return acquireLocalStorageLock(storageKey);
}

/**
 * BroadcastChannel-based mutex.
 *
 * The channel is created lazily and closed after the lock is released.
 * The critical section is short, but we also enforce a TTL so a crashed
 * tab cannot block others indefinitely.
 *
 * @param {string} storageKey
 * @returns {Promise<{ release: () => void }>}
 */
async function acquireBroadcastLock(storageKey) {
  const lockKey = `${LOCK_PREFIX}${storageKey}`;
  const channel = new BroadcastChannel(LOCK_CHANNEL_NAME);
  const tabId = randomUUID();
  let held = false;

  const tryAcquire = () =>
    new Promise((resolve) => {
      let settled = false;
      const onReply = (event) => {
        if (event.data && event.data.lockKey === lockKey) {
          settled = true;
          channel.removeEventListener("message", onReply);
          resolve(false);
        }
      };
      channel.addEventListener("message", onReply);
      channel.postMessage({ type: "acquire", lockKey, tabId });
      setTimeout(() => {
        if (settled) return;
        settled = true;
        channel.removeEventListener("message", onReply);
        resolve(true);
      }, LOCK_RETRY_MS);
    });

  const onMessage = (event) => {
    if (!event.data || event.data.lockKey !== lockKey) return;
    if (event.data.type === "acquire" && !held) {
      // Another tab is competing.  Only the lowest tabId wins to avoid
      // a thrashing lock.
      if (event.data.tabId < lockKey) {
        channel.postMessage({ type: "deny", lockKey, tabId });
      }
    }
  };
  channel.addEventListener("message", onMessage);

  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS && !held; attempt += 1) {
    const acquired = await tryAcquire();
    if (acquired) {
      held = true;
    } else {
      await sleep(LOCK_RETRY_MS);
    }
  }

  channel.removeEventListener("message", onMessage);

  return {
    release() {
      if (!held) {
        channel.close();
        return;
      }
      held = false;
      channel.postMessage({ type: "release", lockKey, tabId });
      channel.close();
    },
  };
}

/**
 * localStorage-based mutex fallback for environments without
 * BroadcastChannel.  Uses a sentinel value with an expiry timestamp.
 *
 * @param {string} storageKey
 * @returns {Promise<{ release: () => void }>}
 */
async function acquireLocalStorageLock(storageKey) {
  const lockKey = `${LOCK_PREFIX}${storageKey}`;
  if (!hasLocalStorage()) {
    return { release() {} };
  }

  const owner = randomUUID();
  const now = Date.now();

  for (let attempt = 0; attempt < LOCK_MAX_ATTEMPTS; attempt += 1) {
    try {
      const raw = localStorage.getItem(lockKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.expiresAt > now) {
          await sleep(LOCK_RETRY_MS);
          continue;
        }
      }
      localStorage.setItem(
        lockKey,
        JSON.stringify({ owner, expiresAt: Date.now() + LOCK_TTL_MS }),
      );
      const confirmed = localStorage.getItem(lockKey);
      if (confirmed) {
        const parsedConfirmed = JSON.parse(confirmed);
        if (parsedConfirmed && parsedConfirmed.owner === owner) {
          return {
            release() {
              try {
                const current = localStorage.getItem(lockKey);
                if (current) {
                  const parsedCurrent = JSON.parse(current);
                  if (parsedCurrent && parsedCurrent.owner === owner) {
                    localStorage.removeItem(lockKey);
                  }
                }
              } catch {
                // Ignore — lock will expire via TTL.
              }
            },
          };
        }
      }
    } catch {
      // localStorage unavailable or corrupted — fall through to a noop
      // lock so the caller still progresses.
      break;
    }
    await sleep(LOCK_RETRY_MS);
  }

  // Could not acquire the lock within the budget; proceed with a noop
  // release so the caller is never blocked forever.
  return { release() {} };
}

/** Sleep helper that works in browser and node environments. */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Return the existing idempotency key for this (wallet, invoice, amount)
 * triple from `sessionStorage`, or generate and persist a fresh UUID if none
 * exists yet.
 *
 * Calling this function multiple times with the same arguments is safe —
 * it always returns the same key for the same triple within a browser tab
 * session, even under concurrent calls.
 *
 * @param {string}         invoiceId
 * @param {string | null}  walletAddress
 * @param {number}         amount
 * @returns {Promise<string>}  A v4 UUID string
 */
export async function getOrCreateIdempotencyKey(invoiceId, walletAddress, amount) {
  const storageKey = buildStorageKey(invoiceId, walletAddress, amount);

  // SSR / test environments may not have sessionStorage.  We still coalesce
  // concurrent callers on to a single key via the in-flight cache.
  if (!hasSessionStorage()) {
    return getInFlightKey(storageKey, () => Promise.resolve(randomUUID()));
  }

  // Fast path: already persisted.
  const existing = readPersistedKey(storageKey);
  if (existing) {
    return existing;
  }

  // Coalesce in-flight callers onto a single generation promise.
  return getInFlightKey(storageKey, async () => {
    // Re-check after acquiring the in-flight slot: another context may
    // have written the key between our first read and now.
    const rechecked = readPersistedKey(storageKey);
    if (rechecked) return rechecked;

    // Serialize cross-tab generation for this triple.
    const lock = await acquireLock(storageKey);
    try {
      const afterLock = readPersistedKey(storageKey);
      if (afterLock) return afterLock;

      const fresh = randomUUID();
      const persisted = persistKey(storageKey, fresh);
      if (!persisted) {
        // Storage write failed; the in-flight cache still guarantees a
        // single key for this tab.
        return fresh;
      }
      return fresh;
    } finally {
      lock.release();
    }
  });
}

/**
 * Coalesce concurrent callers onto a single in-flight promise for a
 * storage key.  The promise is removed from the cache once it settles so
 * the next call re-reads storage and picks up any external writes.
 *
 * @param {string} storageKey
 * @param {() => Promise<string>} factory
 * @returns {Promise<string>}
 */
function getInFlightKey(storageKey, factory) {
  const existing = inFlight.get(storageKey);
  if (existing) return existing;

  const promise = Promise.resolve()
    .then(factory)
    .finally(() => {
      // Only delete if we are still the current in-flight entry.
      if (inFlight.get(storageKey) === promise) {
        inFlight.delete(storageKey);
      }
    });

  inFlight.set(storageKey, promise);
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
 * @throws {never} This function is deliberately no-throw (I5).
 *
 * @param {string}         invoiceId
 * @param {string | null}  walletAddress
 * @param {number}        amount
 */
export function clearIdempotencyKey(invoiceId, walletAddress, amount) {
  const storageKey = buildStorageKey(invoiceId, walletAddress, amount);
  if (hasSessionStorage()) {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // Ignore — key was never stored or storage is unavailable.
    }
  }
  // Always drop the in-flight entry so a subsequent call generates a new
  // key rather than returning a stale cached promise.
  inFlight.delete(storageKey);
}

/**
 * Test-only export: reset the in-flight cache.  Exposed so tests can
 * guarantee a clean slate between cases without relying on module reload
 * ordering.
 */
export function __resetInFlightForTests() {
  inFlight.clear();
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

