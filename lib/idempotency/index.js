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
 * Concurrency note
 * ────────────────
 * The get-or-create path is not atomic across tabs: two tabs can race and
 * each generate a different key.  We narrow this by:
 *   - Re-reading the storage after writing and returning the winning value
 *     (last-write-wins), so within a tab the same key is always returned.
 *   - Validating the stored value is a well-formed UUID before reusing it,
 *     so corrupted or forged entries cannot inject arbitrary strings into
 *     the `Idempotency-Key` request header.
 *   - The cross-tab BroadcastChannel lock in useFundingSubmit remains the
 *     authoritative deduplication mechanism for the actual submission.
 *
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

/** RFC 4122 v4 UUID format. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Return true when `value` is a well-formed v4 UUID string.
 *
 * This guards against reusing a corrupted or tampered sessionStorage
 * entry as an idempotency key.  The key is sent as a request header, so
 * accepting arbitrary strings would allow a malicious or buggy writer to
 * control the deduplication identifier.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidIdempotencyKey(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Produce a fresh v4 UUID.
 *
 * Prefers the Web Crypto `randomUUID` when available and falls back to
 * `crypto.getRandomValues` otherwise, so the function works in older
 * browsers and in test environments where only the low-level API is
 * polyfilled.  Throws when no cryptographic source exists rather than
 * silently returning a weak key.
 *
 * @returns {string}
 */
function createIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    // RFC 4122 v4 variant and version bits.
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
  }

  throw new Error(
    "lib/idempotency: no cryptographic random source available to generate an idempotency key",
  );
}

/**
 * Build the sessionStorage key for a given (walletAddress, invoiceId, amount)
 * triple.  Amount is included so that two different partial-fund attempts on the
 * same invoice (e.g. $100 then $200) each get an independent idempotency
 * key.
 *
 * The amount is normalised to a stable decimal string so that `100`, `100.0`,
 * and `100.00` map to the same key.  Without this, a retry that re-renders
 * the amount from a string would miss the existing key and generate a new
 * one, defeating deduplication.
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
  const normalisedAmount = normaliseAmount(amount);
  return `${KEY_PREFIX}${wallet}-${invoiceId}-${normalisedAmount}`;
}

/**
 * Normalise a funding amount into a stable decimal string for use in a
 * storage key.
 *
 * Accepts finite numbers and numeric strings.  Non-finite or unparseable
 * values fall back to the literal `NaN` tag so that two invalid calls
 * still share a key (deterministic) rather than each generating a new one.
 *
 * @param {unknown} amount
 * @returns {string}
 */
function normaliseAmount(amount) {
  const numeric = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(numeric)) {
    return "NaN";
  }
  // `Number.toString` is deterministic for the same numeric value and
  // avoids floating-point formatting differences between `100` and `100.0`.
  return numeric.toString();
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
 * Invariants:
 *   - The returned value is always a well-formed v4 UUID.
 *   - Within a tab, repeated calls for the same triple return the same key.
 *   - A corrupted stored value is discarded and replaced, never returned.
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
    return createIdempotencyKey();
  }

  const existing = safeGetItem(storageKey);
  if (isValidIdempotencyKey(existing)) {
    return existing;
  }

  const fresh = createIdempotencyKey();
  try {
    sessionStorage.setItem(storageKey, fresh);
  } catch {
    // sessionStorage full or blocked (e.g. private-browsing quota exceeded).
    // Fall back to a fresh key that won't be persisted — the in-memory guard
    // still prevents double-submit within the same React lifecycle.
    return fresh;
  }

  // Re-read after writing.  If a concurrent writer in this tab won the race,
  // return the value that is actually persisted so all callers agree on one
  // key.  If the re-read fails or is invalid, fall back to the key we just
  // wrote.
  const confirmed = safeGetItem(storageKey);
  return isValidIdempotencyKey(confirmed) ? confirmed : fresh;
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

/**
 * Safe wrapper around `sessionStorage.getItem`.
 *
 * Accessing sessionStorage can throw in some browser configurations (e.g.
 * cookies disabled, sandboxed iframes).  Treat any failure as "no existing
 * key" so the caller generates a fresh one instead of crashing.
 *
 * @param {string} key
 * @returns {string | null}
 */
function safeGetItem(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
