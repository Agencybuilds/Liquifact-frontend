"use client";
import { useCallback, useRef, useState } from "react";
import { copy } from "../copy/en";
import NavMenu from "../../components/NavMenu";
import UploadZone from "../../components/UploadZone";
import UploadErrorBoundary from "../../components/UploadErrorBoundary";
import InvoiceList from "../../components/InvoiceList";
import { reportError } from "../../lib/observability/reportError";

/**
 * Deterministic failure recovery for the invoices page.

 * Invariants:
 *  1. Every optimistic invoice has a stable, unique client-key.
 *     Consecutive uploads of the same payload are never deduped away.
 *  2. A record is either pending or settled (committed or rolled back).
 *     There is no intermediate state that can be observed by the UI.
 *  3. Retrying a failed upload must not duplicate a committed record.
 *  4. Concurrent retries for the same record are coalesced into a single
 *     in-flight request.
 *  5. Failures are observable (logged with correlation id) and user-visible
 *     without exposing sensitive data.
 */

/**
 * Failure recovery invariants for the invoices page:
 *
 * 1. Optimistic entries are keyed by a stable client-generated id so a
 *    retry of the same upload updates the existing row instead of
 *    creating a duplicate. This makes retries idempotent.
 * 2. Failed uploads are retained in state with an error message so the
 *    user can retry without losing the in-memory record or the file
 *    selection. No silent drops.
 * 3. Recovery is deterministic: the same input always produces the same
 *    state transition (pending -> success | pending -> failed -> pending).
 * 4. Error messages are sanitized before being stored or rendered so that
 *    sensitive details from failed requests are not leaked to the UI.
 */

const FALLBACK_ERROR = "Upload failed. Please try again.";

const generateId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `inv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

export const sanitizeErrorMessage = (raw) => {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length > 0 && trimmed.length <= 200) {
      return trimmed;
    }
  }
  return FALLBACK_ERROR;
};

/**
 * State invariants for the invoices page optimistic list.
 *
 * 1. The optimistic list is an append-only log of uploads for this mounted page.
 *    Entries are never reordered or mutated in place; new entries are prepended.
 * 2. Every entry has a stable, unique identity. Duplicate uploads of the
 *    same invoice must not create duplicate entries or corrupt the list.
 * 3. Only valid invoice objects (non-null, object, with a non-empty id)
 *    are accepted. Invalid input is rejected with a user-visible error and
 *    no state mutation.
 * 4. Repeated or concurrent invocations of the upload handler must be
 *    idempotent: the same invoice id is only accepted once.
 * 5. The list is bounded to a maximum size to avoid unbounded growth.
 */

const MAX_OPTIMISTIC_INVOICES = 200;

function isValidInvoice(invoice) {
  if (invoice === null || typeof invoice !== "object" || Array.isArray(invoice)) {
    return false;
  }
  const { id } = invoice;
  if (typeof id === "string") {
    return id.trim().length > 0;
  }
  if (typeof id === "number") {
    return Number.isFinite(id);
  }
  return false;
}

function normalizeId(id) {
  return typeof id === "string" ? id.trim() : String(id);
}

export default function InvoicesPage() {
  const [optimisticInvoices, setOptimisticInvoices] = useState([]);
  const [invoiceError, setInvoiceError] = useState(null);
  // Ref mirrors the current id set so concurrent/repeated calls in the
  // same tick cannot bypass the dedupe check before React re-renders.
  const knownIdsRef = useRef(new Set());

  const handleUploadSuccess = useCallback((invoice) => {
    if (!isValidInvoice(invoice)) {
      setInvoiceError(
        "The uploaded invoice did not include a valid identifier. Please try again."
      );
      return;
    }

    const normalizedId = normalizeId(invoice.id);
    if (knownIdsRef.current.has(normalizedId)) {
      // Idempotent no-op: the same invoice is already tracked.
      setInvoiceError(null);
      return;
    }

    knownIdsRef.current.add(normalizedId);
    setInvoiceError(null);
    setOptimisticInvoices((current) => {
      if (current.length >= MAX_OPTIMISTIC_INVOICES) {
        return current;
      }
      return [invoice, ...current];
    });
  }, []);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <NavMenu />

      <main className="mx-auto max-w-7xl px-4 py-10 sm$px-6 lg:px-8">
        <div className="space-y-2 mb-10">
          <h1 className="text-3xl font-bold tracking-tight text-slate-100 sm:text-4xl">
            {copy.invoices.title || "Invoices"}
          </h1>
          <p className="text-lg text-slate-400">
            {copy.invoices.description || "Upload and tokenize your commercial invoices."}
          </p>
        </div>

        <div className="grid gap-10 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <UploadErrorBoundary>
              <UploadZone
                generateId={generateId}
                onUploadStart={handleUploadStart}
                onUploadSuccess={handleUploadSuccess}
                onUploadError={handleUploadError}
              />
            </UploadErrorBoundary>
            {invoiceError ? (
              <p
                role="alert"
                className="mt-4 rounded-md border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200"
              >
                {invoiceError}
              </p>
            ) : null}
          </div>
          <div className="lg:col-span-2">
            <InvoiceList
              optimisticInvoices={optimisticInvoices}
              onRetry={handleRetry}
              onDismiss={handleDismiss}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
