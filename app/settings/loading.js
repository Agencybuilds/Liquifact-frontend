"use client";

/**
 * @file app/settings/loading.js
 * Next.js route-level loading UI for the /settings page with deterministic failure recovery.
 *
 * Rendered automatically by the Next.js App Router while the page segment
 * is streaming. Delegates the content area to the reusable ThemeSkeleton
 * component so both stay in sync with the real settings layout.
 *
 * Failure Recovery Guarantees:
 * 1. Deterministic State Model: Strictly enforces state transitions between
 *    LOADING, TIMED_OUT, ERROR, RETRYING, and EXHAUSTED states.
 * 2. Timeout Recovery: Guards against hung or stalled route streaming by transitioning
 *    to an actionable, accessible recovery banner after a deterministic threshold.
 * 3. Render Error Guarding: Catches child render crashes inside an internal
 *    error boundary and provides an in-place recovery path.
 * 4. Idempotent Execution: Rapid or duplicate retry actions during active retry or
 *    loading are safely ignored, preventing concurrent race conditions.
 * 5. Bounded Retries: Implements a maximum retry threshold to eliminate infinite loops.
 * 6. Observability: Emits sanitized error context via {@link reportError} without leaking
 *    sensitive user credentials or secrets.
 * 7. Non-Destructive: Preserves existing in-memory/persisted user settings and wallet state.
 * 8. Backwards Compatibility: When invoked without arguments by the App Router, maintains
 *    identical layout structure and attributes.
 *
 * @see components/ThemeSkeleton.jsx — reusable theme/settings skeleton
 * @see components/NavMenuSkeleton.jsx — reusable header skeleton
 * @see components/ErrorBanner.jsx — reusable accessible error banner
 * @see lib/observability/reportError.js — sanitized error reporter
 */

import React, { Component, useState, useEffect, useRef, useCallback } from "react";
import NavMenuSkeleton from "../../components/NavMenuSkeleton";
import ThemeSkeleton from "../../components/ThemeSkeleton";
import ErrorBanner from "../../components/ErrorBanner";
import { reportError } from "../../lib/observability/reportError";
import { copy } from "../copy/en";

/**
 * Deterministic loading lifecycle states.
 * @readonly
 * @enum {string}
 */
export const LOADING_STATES = Object.freeze({
  LOADING: "loading",
  TIMED_OUT: "timed_out",
  ERROR: "error",
  RETRYING: "retrying",
  EXHAUSTED: "exhausted",
});

/** Default timeout threshold (10 seconds) before showing timeout recovery UI */
export const DEFAULT_TIMEOUT_MS = 10000;

/** Default maximum number of retry attempts before halting */
export const DEFAULT_MAX_RETRIES = 3;

/**
 * Class-based Error Boundary to catch render failures within the loading subtree.
 */
export class SettingsLoadingErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    if (typeof this.props.onError === "function") {
      this.props.onError(error, errorInfo);
    }
  }

  reset() {
    this.setState({ hasError: false, error: null });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return typeof this.props.fallback === "function"
          ? this.props.fallback({ error: this.state.error, reset: () => this.reset() })
          : this.props.fallback;
      }
      return null;
    }
    return this.props.children;
  }
}

/**
 * SettingsLoading component with deterministic failure recovery.
 *
 * @param {object} [props]
 * @param {number|null} [props.timeoutMs=DEFAULT_TIMEOUT_MS] - Timeout duration before transitioning
 *   to the TIMED_OUT state. Set to 0 or null to disable timeout.
 * @param {number} [props.maxRetries=DEFAULT_MAX_RETRIES] - Maximum allowed retry attempts.
 * @param {Function} [props.onRetry] - Callback executed on user retry. Can be async.
 * @param {Function} [props.onError] - Callback executed when transitioning to an error/timeout state.
 * @param {Error|null} [props.initialError=null] - Optional pre-existing error.
 * @param {React.ReactNode} [props.children] - Custom loading placeholder (defaults to ThemeSkeleton).
 */
export default function SettingsLoading({
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxRetries = DEFAULT_MAX_RETRIES,
  onRetry,
  onError,
  initialError = null,
  children,
} = {}) {
  // Boundary normalization
  const safeTimeoutMs =
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : null;

  const safeMaxRetries =
    typeof maxRetries === "number" && Number.isFinite(maxRetries) && maxRetries >= 0
      ? Math.floor(maxRetries)
      : DEFAULT_MAX_RETRIES;

  const [status, setStatus] = useState(
    initialError
      ? safeMaxRetries === 0
        ? LOADING_STATES.EXHAUSTED
        : LOADING_STATES.ERROR
      : LOADING_STATES.LOADING
  );
  const [currentError, setCurrentError] = useState(initialError);
  const [retryCount, setRetryCount] = useState(0);
  const [resetKey, setResetKey] = useState(0);

  const isMountedRef = useRef(true);
  const timerRef = useRef(null);
  const isRetryingRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const emitObservability = useCallback((err, phase, currentAttempt) => {
    try {
      reportError(err, {
        boundary: "SettingsLoading",
        phase,
        retryCount: currentAttempt,
      });
    } catch {
      // Safe fallback if reporter sink fails
    }
  }, []);

  // Handle timeout transitions
  useEffect(() => {
    if (status !== LOADING_STATES.LOADING) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    if (safeTimeoutMs !== null) {
      timerRef.current = setTimeout(() => {
        if (!isMountedRef.current) return;
        const timeoutErr = new Error(`Settings loading timed out after ${safeTimeoutMs}ms`);
        timeoutErr.name = "SettingsLoadingTimeoutError";
        timeoutErr.code = "LOADING_TIMEOUT";

        const nextStatus =
          retryCount >= safeMaxRetries ? LOADING_STATES.EXHAUSTED : LOADING_STATES.TIMED_OUT;
        emitObservability(timeoutErr, "timeout", retryCount);
        setStatus(nextStatus);
        setCurrentError(timeoutErr);

        if (typeof onError === "function") {
          try {
            onError(timeoutErr, { phase: "timeout", retryCount });
          } catch {
            // Ignore callback exceptions
          }
        }
      }, safeTimeoutMs);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [status, safeTimeoutMs, retryCount, safeMaxRetries, resetKey, emitObservability, onError]);

  // Handle child render failures caught by error boundary
  const handleChildError = useCallback(
    (caughtError, errorInfo) => {
      if (!isMountedRef.current) return;
      const nextStatus =
        retryCount >= safeMaxRetries ? LOADING_STATES.EXHAUSTED : LOADING_STATES.ERROR;
      emitObservability(caughtError, "render_error", retryCount);
      setStatus(nextStatus);
      setCurrentError(caughtError);

      if (typeof onError === "function") {
        try {
          onError(caughtError, { phase: "render_error", retryCount, ...errorInfo });
        } catch {
          // Ignore callback exceptions
        }
      }
    },
    [emitObservability, retryCount, safeMaxRetries, onError]
  );

  // Idempotent retry handler
  const handleRetry = useCallback(() => {
    // Prevent duplicate triggers if already retrying or actively loading
    if (isRetryingRef.current || status === LOADING_STATES.LOADING) {
      return;
    }

    if (retryCount >= safeMaxRetries) {
      setStatus(LOADING_STATES.EXHAUSTED);
      return;
    }

    const nextAttempt = retryCount + 1;
    isRetryingRef.current = true;
    setStatus(LOADING_STATES.RETRYING);

    const completeSuccess = () => {
      if (!isMountedRef.current) return;
      isRetryingRef.current = false;
      setRetryCount(nextAttempt);
      setResetKey((prev) => prev + 1);
      setCurrentError(null);
      setStatus(LOADING_STATES.LOADING);
    };

    const completeFailure = (err) => {
      if (!isMountedRef.current) return;
      isRetryingRef.current = false;
      setRetryCount(nextAttempt);
      emitObservability(err, "retry_failure", nextAttempt);
      setCurrentError(err);
      setStatus(nextAttempt >= safeMaxRetries ? LOADING_STATES.EXHAUSTED : LOADING_STATES.ERROR);
    };

    if (typeof onRetry === "function") {
      try {
        const result = onRetry({ attempt: nextAttempt, maxRetries: safeMaxRetries });
        if (result && typeof result.then === "function") {
          result.then(completeSuccess, completeFailure);
          return;
        }
      } catch (err) {
        completeFailure(err);
        return;
      }
    }

    completeSuccess();
  }, [status, retryCount, safeMaxRetries, onRetry, emitObservability]);

  const isBusy = status === LOADING_STATES.LOADING || status === LOADING_STATES.RETRYING;
  const isFailed =
    status === LOADING_STATES.TIMED_OUT ||
    status === LOADING_STATES.ERROR ||
    status === LOADING_STATES.EXHAUSTED;

  const errorTitle =
    status === LOADING_STATES.TIMED_OUT
      ? copy?.settings?.timeoutTitle || "Loading timed out"
      : status === LOADING_STATES.EXHAUSTED
        ? copy?.settings?.exhaustedTitle || "Loading failed"
        : copy?.settings?.errorTitle || "Unable to load settings";

  const errorDescription =
    status === LOADING_STATES.TIMED_OUT
      ? copy?.settings?.timeoutDescription ||
        "Settings are taking longer than expected to load. You can try again or check your connection."
      : status === LOADING_STATES.EXHAUSTED
        ? copy?.settings?.exhaustedDescription ||
          "Settings could not be loaded after multiple attempts. Please check your connection or reload the page."
        : copy?.settings?.errorDescription || "Unable to load settings right now.";

  const showAction = isFailed && status !== LOADING_STATES.EXHAUSTED && retryCount < safeMaxRetries;
  const actionLabel = copy?.settings?.retryAction || "Try again";
  const details = retryCount > 0 ? `Attempt ${retryCount} of ${safeMaxRetries}` : undefined;

  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-50"
      aria-busy={isBusy ? "true" : "false"}
      data-testid="settings-loading"
      data-status={status}
    >
      {/* ---- Reusable nav skeleton ---- */}
      <NavMenuSkeleton />

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        {isFailed ? (
          <div data-testid="settings-loading-fallback">
            <ErrorBanner
              variant="error"
              title={errorTitle}
              description={errorDescription}
              actionLabel={showAction ? actionLabel : undefined}
              onAction={showAction ? handleRetry : undefined}
              details={details}
            />
          </div>
        ) : (
          <SettingsLoadingErrorBoundary key={resetKey} onError={handleChildError}>
            {children || <ThemeSkeleton isBusy={true} />}
          </SettingsLoadingErrorBoundary>
        )}
      </main>
    </div>
  );
}

export default SettingsLoading;
