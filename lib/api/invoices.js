// lib/api/invoices.js

import { ApiError } from "./ApiError.js";

const DEFAULT_TIMEOUT_MS = 10_000;

export class InvoiceTimeoutError extends Error {
  constructor(ms) {
    super(`Request timed out after ${ms}ms`);
    this.name = "InvoiceTimeoutError";
  }
}

/**
 * Fetch investable invoices from the backend API.
 *
 * @param {Object} options
 * @param {AbortSignal} [options.signal] - Optional AbortSignal to cancel the request.
 * @param {number} [options.timeoutMs=10000] - Milliseconds before the request is aborted.
 * @returns {Promise<Array<Object>>} Resolves to an array of normalized invoice objects.
 * @throws {InvoiceTimeoutError} Thrown when the request exceeds `timeoutMs`.
 * @throws {import("./ApiError").ApiError} Thrown when the response status is not OK,
 *   the response body is not valid JSON, or the payload is not an array.
 *   Carries `.status` (HTTP code), .code` (stringified status), and optional
 *   `.requestId` from the `X-Request-Id` response header.
 *
 * Invariants:
 * - Concurrent or repeated calls are isolated: each invocation owns its own
 *   AbortController, timer, and listener, so no shared mutable state is exposed.
 * - The returned array is always a fresh array and never aliases the parsed payload.
 * - Abort/cancellation is deterministic: a timeout always surfaces as `InvoiceTimeoutError`,
 *   while a caller-supplied abort surfaces the caller's original reason (AbortError).
 * - The timeout timer is always cleared before the function returns or throws.
 */
export async function fetchInvestableInvoices({ signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
  const url = `${baseUrl.replace(/\/+$/, "")}/invoices`;

  // Reject a caller-supplied signal that is not an AbortSignal-like object so
  // concurrent callers cannot smuggle in a shared, mutable object that would
  // break per-invocation isolation.
  if (signal != null && typeof signal.addEventListener !== "function") {
    throw new TypeError("signal must be an AbortSignal");
  }

  // Validate the timeout up front so a bad value cannot silently disable the guard.
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new RangeError(`timeoutMs must be a non-negative finite number, received ${String(timeoutMs)}`);
  }

  // Fast-path: if the caller already aborted, do not issue a request at all.
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }

  const controller = new AbortController();

  // Record why the controller was aborted so the catch block can distinguish
  // a timeout from a caller cancellation. This is a local flag rather than
  // inspecting `controller.signal.reason`, which is not uniformly supported.
  let timedOut = false;
  let timeoutId = null;
  let settled = false;

  const onParentAbort = () => {
    // Only abort if we have not already abandoned the request due to a timeout.
    if (!timedOut) {
      controller.abort(signal.reason);
    }
  };

  if (signal) {
    signal.addEventListener("abort", onParentAbort, { once: true });
  }

  // Schedule the timeout. When it fires it marks `timedOut` before aborting so the
  // catch block can report a timeout even if the caller signal also fires.
  timeoutId = setTimeout(() => {
    // Guard against a timer that fires after the request has already settled
    // (e.g. a very short timeoutMs racing with a fast response). Without this
    // guard a late timer could abort an already-resolved controller.
    if (settled) return;
    timedOut = true;
    controller.abort(new InvoiceTimeoutError(timeoutMs));
  }, timeoutMs);

  // Ensure the timer and the parent-signal listener are always torn down, even
  // when the caller signal fires during the fetch or when the response body fails.
  const cleanup = () => {
    settled = true;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (signal) {
      signal.removeEventListener("abort", onParentAbort);
    }
  };

  try {
    let response;
    try {
      response = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
        },
      });
    } catch (err) {
      if (err?.name === "AbortError") {
        // Re-check the settled flag so a race between the timer firing and the
        // fetch rejecting cannot produce a non-deterministic error type.
        if (settled && !timedOut) throw err;
        // Timeout takes precedence over a concurrent caller abort so the failure
        // mode is deterministic regardless of which signal fired first.
        if (timedOut) throw new InvoiceTimeoutError(timeoutMs);
        // Caller-supplied signal fired — rethrow as-is so the caller
        // can distinguish an unmount-cancel from a timeout.
        throw err;
      }
      throw err;
    }

    if (!response.ok) {
      // Extract optional X-Request-Id header for log correlation.
      const requestId = response.headers?.get("x-request-id") ?? undefined;
      throw ApiError.fromResponse(
        response,
        `Failed to fetch invoices: ${response.status} ${response.statusText}`,
        String(response.status),
        requestId
      );
    }

    let payload;
    try {
      payload = await response.json();
    } catch (e) {
      // Response body was not valid JSON — throw a typed ApiError so callers
      // can inspect the status code even when the body is unparseable (e.g.
      // a gateway returning an HTML error page with a 200 status).
      throw new ApiError("Response is not valid JSON", response.status, String(response.status));
    }

    if (!Array.isArray(payload)) {
      throw new ApiError("Invoice payload is not an array", response.status, String(response.status));
    }

    // Normalize each invoice to the UI contract, guarding against missing fields.
    // We always build a new array of new objects so the returned value cannot
    // alias the parsed payload or any shared cache.
    const normalized = payload.map((inv) => {
      const {
        id = null,
        issuer = null,
        amount = null,
        currency = null,
        dueDate = null,
        yield: invYield = null,
        status = null,
      } = inv || {};
      return { id, issuer, amount, currency, dueDate, yield: invYield, status };
    });

    return normalized;
  } finally {
    cleanup();
  }
}
