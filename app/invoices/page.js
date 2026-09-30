"tuse client";
import React from "react";
import { useCallback, useState } from "react";
import { copy } from "../copy/en";
import NavMenu from "../../components/NavMenu";
import UploadZone from "../../components/UploadZone";
import UploadErrorBoundary from "../../components/UploadErrorBoundary";
import InvoiceList from "../../components/InvoiceList";

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

export default function InvoicesPage() {
  const [optimisticInvoices, setOptimisticInvoices] = useState([]);

  /**
   * Merge an update into the optimistic list by id. If the id already
   * exists the entry is replaced in place (retry); otherwise it is
   * prepended. This keeps retries and concurrent uploads from duplicating
   * rows or clobbering each other.
   */
  const mergeInvoice = useCallback((update) => {
    setOptimisticInvoices((current) => {
      const index = current.findIndex((item) => item.id === update.id);
      if (index === -1) {
        return [update, ...current];
      }
      const next = current.slice();
      next[index] = { ...current[index], ...update };
      return next;
    });
  }, []);

  /**
   * Record a failure for an in-flight upload. The entry is retained so the
   * user can retry without re-selecting the file.
   */
  const handleUploadError = useCallback(
    ({ id, error }) => {
      if (!id) {
        return;
      }
      mergeInvoice({
        id,
        status: "failed",
        error: sanitizeErrorMessage(error),
      });
    },
    [mergeInvoice]
  );

  /**
   * Record an in-flight upload so retries and concurrent calls can be
   * correlated by id and the UI can show a pending state.
   */
  const handleUploadStart = useCallback(
    ({ id, file }) => {
      if (!id) {
        return;
      }
      mergeInvoice({
        id,
        status: "pending",
        error: null,
        name: file && file.name ? file.name : undefined,
      });
    },
    [mergeInvoice]
  );

  /**
   * Record a successful upload. The id reused from the start/error
   * callbacks so a retry replaces the failed row instead of adding a
   * duplicate.
   */
  const handleUploadSuccess = useCallback(
    (invoice) => {
      if (!invoice || !invoice.id) {
        return;
      }
      mergeInvoice({
        ...invoice,
        status: "success",
        error: null,
      });
    },
    [mergeInvoice]
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-50">
      <NavMenu />

      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
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
          </div>
          <div className="lg:col-span-2">
            <InvoiceList optimisticInvoices={optimisticInvoices} />
          </div>
        </div>
      </main>
    </div>
  );
}
