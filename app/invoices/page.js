"use client";
import { useCallback, useEffect, useRef } from "react";
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

export default function InvoicesPage() {
  // Optimistic records are stored in a Map keyed by a client-generated
  // correlation id (rather than an array index) so that a retry operation
  // can atomically replace the exact record it owns, even when other
  // uploads arrive in between.
  const [records, setRecords] = React.useState(() => new Map());
  // Tick forces a re-render after mutating the Map in place.
  const [, forceRender] = React.useReducer((n) => n + 1, 0);

  // In-flight requests keyed by correlation id. This guarantees that
  // concurrent retries for the same record coalesce into a single call.
  const inflightRef = React.useRef(new Map());
  // Monotonic counter for correlation ids. Deterministic within a session.
  const seqNumRef = React.useRef(0);
  // Tracks whether the component is still mounted so async callbacks
  // never touch state after unmount.
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const mutateRecord = React.useCallback((id, updater) => {
    const next = new Map(records);
    const current = next.get(id);
    if (!current) return;
    next.set(id, { ...current, ...updates });
    setRecords(next);
  }, [records]);

  /**
   * Attempts to commit an optimistic record. Returns a promise that
   * resolves on success and rejects on failure. The record is always
   * left in a consistent state: either committed or rolled back.
   */
  const commitRecord = React.useCallback(async (id) => {
    // Coalesce concurrent retries for the same record.
    if (inflightRef.current.has(id)) {
      return inflightRef.current.get(id);
    }

    const promise = (async () => {
      const record = records.get(id);
      if (!record) return;

      mutateRecord(id, { status: "pending", error: null });

      try {
        // The upload handler is the authoritative commit point.
        // It must be idempotent for a given correlation id.
        await record.commit();
        if (!mountedRef.current) return;
        mutateRecord(id, { status: "committed", error: null });
      } catch (err) {
        if (!mountedRef.current) return;
        // Roll back to a recoverable state and surface a diagnosable
        // error. We never drop the record here - the user can retry.
        mutateRecord(id, { status: "failed", error: err });
        reportError(err, {
          scope: "invoices.upload",
          correlationId: id,
        });
        throw err;
      } finally {
        inflightRef.current.delete(id);
      }
    })();

    inflightRef.current.set(id, promise);
    return promise;
  }, [mutateRecord, records]);

  /**
   * Handles a successful upload. The `invoice` payload is added as an
   * optimistic record with a deterministic correlation id and a commit
   * function that the page owns. This keeps the UI in control of failure
   * recovery rather than relying on the upload widget.
   */
  const handleUploadSuccess = React.useCallback(
    (invoice, options = {}) => {
      const id = options.correlationId || `inv_${++seqNumRef.current}`;
      const commit =
        typeof options.commit === "function"
          ? options.commit
          : async () => {};

      const next = new Map(records);
      next.set(id, {
        id,
        invoice,
        status: "pending",
        error: null,
        commit,
      });
      setRecords(next);

      // Kick off the commit asynchronously. Failures are recorded on the
      // record and never escape as unhandled rejections.
      commitRecord(id).catch(() => {});

      return id;
    },
    [commitRecord, records]
  );

  /**
   * Retries a failed record. The correlation id is preserved so the
   * commit is idempotent and can't create a duplicate.
   */
  const handleRetry = React.useCallback(
    (id) => {
      commitRecord(id).catch(() => {});
    },
    [commitRecord]
  );

  /**
   * Dismisses a failed record after the user acknowledges the error.
   * This is the only path that removes a record from the list.
   */
  const handleDismiss = React.useCallback(
    (id) => {
      const next = new Map(records);
      const record = next.get(id);
      if (!record || record.status === "pending") return;
      next.delete(id);
      setRecords(next);
    },
    [records]
  );

  const optimisticInvoices = React.useMemo(() => {
    return Array.from(records.values()).map((record) => ({
      ...record.invoice,
      _correlationId: record.id,
      _status: record.status,
      _error: record.error,
    }));
  }, [records]);

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
              <UploadZone onUploadSuccess={handleUploadSuccess} />
            </UploadErrorBoundary>
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
