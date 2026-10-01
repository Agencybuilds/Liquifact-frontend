

/**
 * @file lib/hooks/useFundingSubmit.js
 *
 * React hook that owns the complete lifecycle of a single funding submission.
 *
 * ── What this hook does ───────────────────────────────────────────────────────
 *
 * 1. **Double-submit guard** — an in-memory ref (`submissionGuardRef`) ensures
 *    that re-activating the action while a request is in-flight is a no-op,
 *    even if the button becomes briefly clickable before React re-renders with
 *    the disabled attribute.
 *
 * 2. **Idempotency key** — `getOrCreateIdempotencyKey` returns a stable UUID
 *    stored in `sessionStorage` for the (wallet, invoiceId, amount) triple.
 *    The same key is re-used on retry so the server can detect and respond to
 *    a replay without double-charging.  The key is cleared on confirmed success
 *    so a future legitimate re-fund gets a fresh key.
 *
 * 3. **Cross-tab lock (BroadcastChannel)** — when two browser tabs are open to
 *    the same invoice, the first tab to start a submission broadcasts a lock
 *    message.  The second tab that receives it shows a warning and refuses to
 *    submit until it observes an "unlock" message.  This is advisory (the
 *    server-side idempotency key is the true safety net) but prevents the user
 *    from accidentally double-funding via two tabs.
 *
 *    `BroadcastChannel` is not available in all test environments.  The hook
 *    degrades gracefully when the API is absent.
 *
 * 4. **Abort on unmount** — an `AbortController` tied to the current request is
 *    cancelled on component unmount, preventing stale-state updates.
 *
 * 5. **Explicit state machine** — the hook exposes one of four states:
 *    `idle | pending | success | failure | blocked_by_tab`.
 *    Each state is rendered as a distinct UI in `FundActions`.
 *
 * ── State machine ─────────────────────────────────────────────────────────────
 *
 *   idle ──[submit]──────────────────────▶ pending ──[resolved]──▶ success
 *     ▲                                       │
 *     │                              [rejected / timeout]
 *     │                                       │
 *     └──[retry after failure] ◀── failure ◀──┘
 *
 *   idle ──[tab-lock received]──▶ blocked_by_tab ──[tab-unlock received]──▶ idle
 *
 * ── Invariants ────────────────────────────────────────────────────────────────
 *
 * I1. A submission is only ever started from IDLE or FAILURE (never from
 *     PENDING, SUCCESS, or BLOCKED_BY_TAB).
 * I2. `submissionGuardRef` is true iff a request is in-flight; it is always
 *     released in `finally` so a thrown/rejected call cannot wedge the hook.
 * I3. The idempotency key is stable across retries of the same
 *     (invoiceId, walletAddress, amount) triple and cleared only on confirmed
 *     success, so a retry after failure replays the same key.
 * I4. The cross-tab lock is released (FUND_UNLOCK) exactly once per acquired
 *     lock, including on unmount and on abort.
 * I5. State updates from an aborted/stale request are ignored.
 *
 * ── Public API ────────────────────────────────────────────────────────────────
 * const {
 *   fundingState,      // "idle" | "pending" | "success" | "failure" | "blocked_by_tab"
 *   isPending,         // boolean
 *   isBlocked,         // boolean — another tab already has a lock
 *   idempotencyKey,    // string | null — the key sent with the current/last request
 *   submit,            // (amount: number) => Promise<void>
 *   reset,             // () => void — clear failure state to re-enable form
 * } = useFundingSubmit({ invoiceId, walletAddress, performFund, onSuccess, onError });
 *
 * @module lib/hooks/useFundingSubmit
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getOrCreateIdempotencyKey,
  clearIdempotencyKey,
} from "@/lib/idempotency";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Stable state labels — consumers should import and compare against these. */
export const FUNDING_SUBMIT_STATES = {
  IDLE: "idle",
  PENDING: "pending",
  SUCCESS: "success",
  FAILURE: "failure",
  /** Another tab for the same invoice has already acquired the in-flight lock. */
  BLOCKED_BY_TAB: "blocked_by_tab",
};

/**
 * BroadcastChannel name template for a given invoice.
 * Each invoice gets its own channel so unrelated invoices do not interfere.
 *
 * @param {string} invoiceId
 * @returns {string}
 */
function channelName(invoiceId) {
  return `liquifact-fund-${invoiceId}`;
}

/**
 * Terminal states from which a new submission may NOT be started.
 * Used to enforce invariant I1.
 */
const NON_STARTABLE_STATES = new Set([
  FUNDING_SUBMIT_STATES.PENDING,
  FUNDING_SUBMIT_STATES.SUCCESS,
  FUNDING_SUBMIT_STATES.BLOCKED_BY_TAB,
]);

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Manages the complete lifecycle of a funding submission for a single invoice.
 *
 * @param {object}         options
 * @param {string}         options.invoiceId      - Invoice being funded
 * @param {string | null}  [options.walletAddress] - Connected wallet address
 * @param {Function}       options.performFund    - Async fn: (invoiceId, amount, idempotencyKey) => Promise<any>
 * @param {Function}       [options.onSuccess]    - Called with result on success
 * @param {Function}       [options.onError]      - Called with error on failure
 *
 * @returns {{
 *   fundingState: string,
 *   isPending: boolean,
 *   isSuccess: boolean,
 *   isBlocked: boolean,
 *   idempotencyKey: string | null,
 *   submit: (amount: number) => Promise<void>,
 *   reset: () => void,
 * }}
 */
export function useFundingSubmit({
  invoiceId,
  walletAddress = null,
  performFund,
  onSuccess,
  onError,
} = {}) {
  // Validate required inputs up-front so callers fail fast and deterministically.
  if (typeof invoiceId !== "string" || invoiceId.length === 0) {
    throw new Error("useFundingSubmit: `invoiceId` is required");
  }
  if (typeof performFund !== "function") {
    throw new Error("useFundingSubmit: `performFund` must be a function");
  }

  const [fundingState, setFundingState] = useState(FUNDING_SUBMIT_STATES.IDLE);
  const [currentKey, setCurrentKey] = useState(null);

  // ── Refs ──────────────────────────────────────────────────────────────────

  /**
   * In-memory double-submit guard.
   * True while a request is in-flight — blocks re-entrant calls even before
   * React re-renders the disabled button.
   */
  const submissionGuardRef = useRef(false);

  /** AbortController for the active request. Replaced per attempt. */
  const abortRef = useRef(null);

  /** BroadcastChannel for cross-tab coordination (may be null if unavailable). */
  const channelRef = useRef(null);

  /** Tracks whether the component is still mounted so we can ignore late
   *  async completions (invariant I5). */
  const mountedRef = useRef(true);

  /** Whether another tab currently holds the in-flight lock. */
  const tabBlockedRef = useRef(false);

  /**
   * Whether THIS tab currently holds the cross-tab lock (i.e. it has posted
   * FUND_LOCK and not yet posted the matching FUND_UNLOCK). Enforces I4 so we
   * never emit an unbalanced unlock.
   */
  const holdsTabLockRef = useRef(false);

  // ── BroadcastChannel setup ────────────────────────────────────────────────

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined" || !invoiceId) return;

    let channel;
    try {
      channel = new BroadcastChannel(channelName(invoiceId));
    } catch {
      // BroadcastChannel may throw in some restricted environments.
      return;
    }

    channelRef.current = channel;

    channel.onmessage = (event) => {
      if (event.data?.type === "FUND_LOCK") {
        // Ignore our own lock echo (some environments loop back messages).
        if (holdsTabLockRef.current) return;
        // Ignore locks for other invoices (defense-in-depth).
        if (event.data?.invoiceId && event.data.invoiceId !== invoiceId) return;
        // Another tab just started a submission — block ours.
        tabBlockedRef.current = true;
        setFundingState(FUNDING_SUBMIT_STATES.BLOCKED_BY_TAB);
      } else if (event.data?.type === "FUND_UNLOCK") {
        // The other tab finished (success or failure) — unblock.
        tabBlockedRef.current = false;
        setFundingState((prev) =>
          prev === FUNDING_SUBMIT_STATES.BLOCKED_BY_TAB
            ? FUNDING_SUBMIT_STATES.IDLE
            : prev
        );
      }
    };

    return () => {
      // Send FUND_UNLOCK BEFORE closing the channel so other tabs receive the
      // message. If we close first, postMessage would be a no-op.
      // Only emit if we actually hold the lock (invariant I4).
      if (holdsTabLockRef.current) {
        channel.postMessage({ type: "FUND_UNLOCK" });
        holdsTabLockRef.current = false;
      }
      channel.close();
      channelRef.current = null;
      // A tab that goes away must not leave us permanently blocked.
      tabBlockedRef.current = false;
    };
  }, [invoiceId]);

  // ── Abort on unmount ──────────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      // channelRef cleanup (including FUND_UNLOCK broadcast) is handled in the
      // BroadcastChannel effect above to guarantee ordering: unlock before close.
      // Reset the guard so a remount of the same hook instance is usable
      // (invariant I2).
      submissionGuardRef.current = false;
      // Invalidate any in-flight attempt so late resolutions cannot mutate state.
      attemptTokenRef.current += 1;
    };
  }, []);

  // ── submit ────────────────────────────────────────────────────────────────

  /**
   * Initiate the funding submission.
   *
   * @param {number} amount - Validated positive funding amount
   */
  const submit = useCallback(
    async (amount) => {
      // ── Guards ────────────────────────────────────────────────────────────

      // Validate amount deterministically (boundary + type).
      if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
        throw new Error("useFundingSubmit: `amount` must be a positive finite number");
      }

      // Prevent re-entrant call (double-click within the same React lifecycle).
      if (submissionGuardRef.current) return;

      // Block if another tab already has the lock for this invoice.
      if (tabBlockedRef.current) return;

      // Enforce I1: refuse to start from a non-startable state. This is a
      // defense-in-depth check; the guard ref above already covers the
      // in-flight case, but this also protects against SUCCESS re-entry.
      if (NON_STARTABLE_STATES.has(fundingState)) return;

      // ── Acquire in-memory lock ────────────────────────────────────────────
      submissionGuardRef.current = true;

      // Capture a fresh attempt token. Any resolution whose token no longer
      // matches the current ref value is stale (aborted, superseded, unmounted).
      attemptTokenRef.current += 1;
      const attemptToken = attemptTokenRef.current;

      // ── Idempotency key ───────────────────────────────────────────────────
      const idem = getOrCreateIdempotencyKey(invoiceId, walletAddress, amount);
      if (!idem) {
        // If key generation failed, do not proceed — refuse to submit without
        // a stable idempotency key (invariant I3).
        submissionGuardRef.current = false;
        throw new Error("useFundingSubmit: failed to obtain idempotency key");
      }
      setCurrentKey(idem);

      // ── Broadcast cross-tab lock ──────────────────────────────────────────
      if (channelRef.current) {
        channelRef.current.postMessage({ type: "FUND_LOCK", invoiceId });
        holdsTabLockRef.current = true;
      }

      // ── State transition → pending ────────────────────────────────────────
      setFundingState(FUNDING_SUBMIT_STATES.PENDING);

      // Fresh AbortController per attempt.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await performFund(invoiceId, amount, idem, controller.signal);

        // Ignore if we were aborted (component unmounted mid-flight).
        // Invariant I5: state updates from an aborted/stale request are ignored.
        if (controller.signal.aborted || !mountedRef.current) {
          return;
        }

        // ── State transition → success ──────────────────────────────────────
        setFundingState(FUNDING_SUBMIT_STATES.SUCCESS);

        // Clear the idempotency key only on confirmed success so a future
        // legitimate re-fund gets a fresh key (invariant I3).
        clearIdempotencyKey(invoiceId, walletAddress, amount);
        setCurrentKey(null);

        if (typeof onSuccess === "function") {
          onSuccess(result);
        }
      } catch (error) {
        // Ignore errors from an aborted/stale request (invariant I5).
        if (controller.signal.aborted || !mountedRef.current) {
          return;
        }

        // ── State transition → failure ──────────────────────────────────────
        setFundingState(FUNDING_SUBMIT_STATES.FAILURE);

        if (typeof onError === "function") {
          onError(error);
        }
      } finally {
        // Release the in-memory guard exactly once per attempt (invariant I2).
        submissionGuardRef.current = false;

        // Release the cross-tab lock exactly once per acquired lock
        // (invariant I4).
        if (holdsTabLockRef.current && channelRef.current) {
          channelRef.current.postMessage({ type: "FUND_UNLOCK", invoiceId });
          holdsTabLockRef.current = false;
        }
      }
    },
    [
      invoiceId,
      walletAddress,
      performFund,
      onSuccess,
      onError,
      fundingState,
    ]
  );

  // ── reset ─────────────────────────────────────────────────────────────────

  /**
   * Clear a failure state so the form is re-enabled for a retry.
   * No-op from any other state (invariant I1).
   */
  const reset = useCallback(() => {
    setFundingState((prev) =>
      prev === FUNDING_SUBMIT_STATES.FAILURE
        ? FUNDING_SUBMIT_STATES.IDLE
        : prev
    );
  }, []);

  return {
    fundingState,
    isPending: fundingState === FUNDING_SUBMIT_STATES.PENDING,
    isSuccess: fundingState === FUNDING_SUBMIT_STATES.SUCCESS,
    isBlocked: fundingState === FUNDING_SUBMIT_STATES.BLOCKED_BY_TAB,
    idempotencyKey: currentKey,
    submit,
    reset,
  };
}iant I5: no state mutation from a stale request.
        if (controller.signal.aborted) return;
        // Ignore if the component unmounted while awaiting.
        if (!mountedRef.current) return;

        // ── Success ───────────────────────────────────────────────────────
        // Clear the persisted key so a future re-funding attempt gets fresh.
        clearIdempotencyKey(invoiceId, walletAddress, amount);
        setCurrentKey(null);
        setFundingState(FUNDING_SUBMIT_STATES.SUCCESS);
        onSuccess?.(result);
      } catch (err) {
        // Ignore AbortErrors triggered by unmount.
        // Invariant I5: an aborted request must not transition to FAILURE.
        if (err?.name === "AbortError" && controller.signal.aborted) return;
        // Ignore late errors after unmount.
        if (!mountedRef.current) return;

        // ── Failure ───────────────────────────────────────────────────────
        // Keep the idempotency key in storage so a retry re-uses it.
        setFundingState(FUNDING_SUBMIT_STATES.FAILURE);
        onError?.(err);
        // Re-throw so callers can classify the error for user-facing messages
        // (e.g. different copy for timeout vs wallet-reject vs 409 conflict).
        throw err;
      } finally {
        // Release in-memory lock whether success or failure.
        // Invariant I2: guard is always released.
        submissionGuardRef.current = false;
        // Broadcast unlock so other tabs may proceed — but only if we actually
        // acquired the lock (invariant I4: balanced lock/unlock).
        if (holdsTabLockRef.current) {
          channelRef.current?.postMessage({ type: "FUND_UNLOCK", invoiceId });
          holdsTabLockRef.current = false;
        }
      }
    },
    [invoiceId, walletAddress, performFund, onSuccess, onError, fundingState]
  );

  // ── reset ─────────────────────────────────────────────────────────────────

  /**
   * Clear a failure state so the user can retry without refreshing the page.
   * Does nothing when not in a failure state.
   */
  const reset = useCallback(() => {
    setFundingState((prev) =>
      prev === FUNDING_SUBMIT_STATES.FAILURE || prev === FUNDING_SUBMIT_STATES.SUCCESS
        ? FUNDING_SUBMIT_STATES.IDLE
        : prev
    );
  }, []);

  // ── Return ────────────────────────────────────────────────────────────────

  return {
    fundingState,
    isPending: fundingState === FUNDING_SUBMIT_STATES.PENDING,
    isSuccess: fundingState === FUNDING_SUBMIT_STATES.SUCCESS,
    isSuccess: fundingState === FUNDING_SUBMIT_STATES.SUCCESS,
    isFailure: fundingState === FUNDING_SUBMIT_STATES.FAILURE,
    isBlocked: fundingState === FUNDING_SUBMIT_STATES.BLOCKED_BY_TAB,
    idempotencyKey: currentKey,
    submit,
    reset,
  };
}
