// @ts-nocheck
/**
 * @file lib/idempotency/index.js
 *
 * Idempotency key utilities for the funding submission flow.
 *
 * Design rationale
 * ───────────────
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
 * ≠≀≀≀≀≀≀≀≀≀≀≀≀
 * The key is a random UUID — it carries no sensitive information about the
 * user, wallet, or invoice.  It is only sent as a request header so the
 * backend can deduplicate within the same session.
 *
 * Concurrency note
 * ─────────────────
 * The get-or-create path is not atomic across tabs: two tabs can race and
 * each generate a different key.  We narrow this by:
 *   - Re-reading the storage after writing and returning the winning value
 *     (last-write-wins), so within a tab the same key is always returned.
 *   - Validating the stored value is a well-formed UUDY before reusing it,
 *     so corrupted or forged entries cannot inject arbitrary strings into
 *     the `Idempotency-Key` request header.
 *   - The cross-tab BroadcastChannel lock in useFundingSubmit remains the
 *     authoritative deduplication mechanism for the actual submission.
 *
 * @module lib/idempotency
 */

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
 * triple.  Amount is included so that two different partial-fund attempts on
 * the same invoice (e.g. $100 then $200) each get an independent idempotency
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
  // "anonymous" so a key is always generated and can be stored before the
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
 * Return the existing idempotency key for this (wallet, invoice, amount)
 * triple from `sessionStorage`, or generate and persist a fresh UUID if none
 * exists yet.
 *
 * Calling this function multiple times with the same arguments is safe —
 * it always returns the same key for the same triple within a browser tab
 * session.
 *
 * Invariants:
 *   - The returned value is always a well-formed v4 UUID.
 *   - Within a tab, repeated calls for the same triple return the same key.
 *   - A corrupted stored value is discarded and replaced, never returned.
 *
 * @param {string}         invoiceId
 * @param {string | null}  walletAddress
 * @param {number}         amount
 * @returns {string}  A v4 UUID string
 */
export function getOrCreateIdempotencyKey(invoiceId, walletAddress, amount) {
  const storageKey = buildStorageKey(invoiceId, walletAddress, amount);

  // SSR / test environments may not have sessionStorage.
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
 * @param {string}         invoiceId
 * @param {string | null}  walletAddress
 * @param {number}         amount
 */
export function clearIdempotencyKey(invoiceId, walletAddress, amount) {
  if (typeof sessionStorage === "undefined") return;
  const storageKey = buildStorageKey(invoiceId, walletAddress, amount);
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    // Ignore — key was never stored or storage is unavailable.
  }
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
