// lib/api/invoices.js

import { ApiError } from "./ApiError.js";

const DEFAULT_TIMEOUT_MS = 10_000;

const DEFAULT_TIMEOUT_MS = 10_000;

export class InvoiceTimeoutError extends Error {
  constructor(ms) {
    super(`Request timed out after ${ms}ms`);
    this.name = "InvoiceTimeoutError";
  }
}

function isAbortError(err) {
  return err?.name === "AbortError" || err?.name === "TimeoutError";
}

function normalizeTimeoutMs(timeoutMs) {
  const n = Number(timeoutMs);
  if (!Number.isFinite(n) || n <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return n;
}

/**
 * Normalize a single invoice object to the UI contract.
 * Guards against missing or non-object entries so downstream code
 * can rely on a deterministic shape.
 */
function normalizeInvoice(inv) {
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
 */
export async function fetchInvestableInvoices({ signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const effectiveTimeoutMs = normalizeTimeoutMs(timeoutMs);
  const baseUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
  const url = `${baseUrl.replace(/\/+$/, "")}/invoices`;

  // Deterministic failure recovery: a caller-supplied signal that is
  // already aborted must not issue a network request and must reject
  // with the caller's own reason so the caller can distinguish it from
  // a timeout. This is the first invariant of this function.
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("Aborted", "AbortError");
  }

  const controller = new AbortController();

  // Track whether the authoritative cause of abort was our own timeout.
  // We use a flag rather than inspecting the error name so the outcome
  // is deterministic even if the runtime reports a different error shape.
  let timedOut = false;

  // Register the caller's abort listener and remember the detach function
  // so we can always clean it up in the finally block. Leaking listeners
  // on a long-lived signal would be a silent memory leak and a source of
  // non-deterministic behavior across retries.
  let detachCallerSignal = () => {};
  if (signal) {
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    detachCallerSignal = () => signal.removeEventListener("abort", onAbort);
  }

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, effectiveTimeoutMs);

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
    // Normalize the abort cause into a deterministic outcome:
    //   - our timeout fired  -> InvoiceTimeoutError (recoverable, retryable)
    //   - caller aborted      -> rethrow the caller's own reason as-is
    //   - any other failure  -> rethrow as-is so the caller can inspect it
    if (err?.name === "AbortError") {
      if (timedOut) throw new InvoiceTimeoutError(timeoutMs);
      throw signal?.reason ?? err;
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    detachCallerSignal();
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
  } catch {
    // Response body was not valid JSON — throw a typed ApiError so callers
    // can inspect the status code even when the body is unparseable (e.g.
    // a gateway returning an HTML error page with a 200 status).
    throw new ApiError("Response is not valid JSON", response.status, String(response.status));
  }

  if (!Array.isArray(payload)) {
    throw new ApiError("Invoice payload is not an array", response.status, String(response.status));
  }

  // Normalize each invoice to the UI contract, guarding against missing fields.
  // The mapping is pure and order-preserving, so duplicate or boundary
  // entries produce a deterministic result without mutating input.
  const normalized = payload.map(normalizeInvoice);

  return normalized;
}
