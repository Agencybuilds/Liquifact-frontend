/* eslint-disable react-hooks/exhaustive-deps */
/* @jsxRuntime automatic */
"use client";

/**
 * @file app/invest/[id]/InvoiceDetailItems.jsx
 *
 * Bulk-selectable list of invoice-detail documents (PDF, proof of delivery,
 * payment terms, etc.) on the invoice detail page.
 *
 * Composition:
 *   - Tri-state select-all via shared `BulkActionsToolbar`
 *   - Per-row checkboxes (keyboard accessible, labelled)
 *   - Non-destructive Export (JSON download)
 *   - Destructive Delete gated behind `ConfirmDialog`
 *   - Results announced via toast + the toolbar's polite live region
 *
 * Selection auto-prunes when items are deleted (via `useBulkSelection`).
 */

import { useCallback, useRef, useState } from "react";
import BulkActionsToolbar from "@/components/BulkActionsToolbar";
import ConfirmDialog from "@/components/ConfirmDialog";
import useBulkSelection, { ALL_STATES } from "@/lib/hooks/useBulkSelection";
import { copy } from "@/app/copy/en";

const bulkLabels = copy.invest.detail.bulk;

const MAX_DETAIL_ITEMS = 500;
const MAX_ID_LENGTH = 256;
const MAX_NAME_LENGTH = 256;
const MAX_KIND_LENGTH = 64;
const MAX_ISSUER_LENGTH = 256;

/**
 * Validation invariants for invoice detail items.
 *
 * A detail item is considered valid iff:
 *   - it is a non-null object
 *   - `id` is a non-empty string of length <= MAX_ID_LENGTH
 *   - `name` is a non-empty string of length <= MAX_NAME_LENGTH
 *   - `kind`, when present, is a string of length <= MAX_KIND_LENGTH
 *   - `issuer`, when present, is a string of length <= MAX_ISSUER_LENGTH
 *
 * Duplicates are detected by `id`. The first occurrence wins; later
 * duplicates are dropped so downstream selection/delete operations cannot
 * act on ambiguous identities.
 *
 * @param {unknown} item
 * @returns {boolean}
 */
export function isValidDetailItem(item) {
  if (!item || typeof item !== "object") return false;
  if (typeof item.id !== "string") return false;
  const id = item.id.trim();
  if (id.length === 0 || id.length > MAX_ID_LENGTH) return false;
  if (typeof item.name !== "string") return false;
  // eslint-disable-next-line no-unused-vars
  const name = item.name.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) return false;
  if (item.kind !== undefined && item.kind !== null) {
    if (typeof item.kind !== "string" || item.kind.length > MAX_KIND_LENGTH) return false;
  }
  if (item.issuer !== undefined && item.issuer !== null) {
    if (typeof item.issuer !== "string" || item.issuer.length > MAX_ISSUER_LENGTH) return false;
  }
  return true;
}

/**
 * Normalize and validate a list of detail items.
 * Returns `{ items, rejected }` where `rejected` is the count of dropped
 * entries (invalid shape, out-of-bound fields, or duplicate ids).
 *
 * @param {unknown} rawItems
 * @returns {{ items: Array<object>, rejected: number }}
 */
export function sanitizeDetailItems(rawItems) {
  if (!Array.isArray(rawItems)) {
    return { items: [], rejected: 0 };
  }
  const seen = new Set();
  const items = [];
  let rejected = 0;
  for (const raw of rawItems) {
    if (!isValidDetailItem(raw)) {
      rejected += 1;
      continue;
    }
    const id = raw.id.trim();
    if (seen.has(id)) {
      rejected += 1;
      continue;
    }
    if (items.length >= MAX_DETAIL_ITEMS) {
      rejected += 1;
      continue;
    }
    seen.add(id);
    items.push({
      ...raw,
      id,
      name: raw.name.trim(),
      kind: raw.kind == null ? raw.kind : raw.kind,
      issuer: raw.issuer == null ? raw.issuer : raw.issuer,
    });
  }
  return { items, rejected };
}

/**
 * Build the default set of detail documents for an invoice.
 * Pure helper — safe to call from Server Components.
 *
 * @param {{ id: string, issuer?: string } | null | undefined} invoice
 * @returns {Array<{ id: string, name: string, kind: string, issuer: string }>}
 */
// eslint-disable-next-line no-unused-vars
export function buildInvoiceDetailItems(invoice) {
  if (!invoice || typeof invoice.id !== "string" || invoice.id.length === 0) {
    return [];
  }
  const issuer = invoice.issuer || "Unknown issuer";
  return [
    {
      id: `${invoice.id}-doc-invoice`,
      name: "Invoice PDF",
      kind: "document",
      issuer,
    },
    {
      id: `${invoice.id}-doc-pod`,
      name: "Proof of delivery",
      kind: "document",
      issuer,
    },
    {
      id: `${invoice.id}-doc-terms`,
      name: "Payment terms",
      kind: "document",
      issuer,
    },
  ];
}

/**
 * Default JSON export for selected detail items.
 * Degrades gracefully in jsdom / SSR (no `URL.createObjectURL`).
 *
 * @param {Array<object>} selectedItems
 * @returns {{ count: number }}
 */
export function defaultDetailBulkExport(selectedItems) {
  const safeRecords = Array.isArray(selectedItems) ? selectedItems : [];
  if (
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    typeof document === "undefined"
  ) {
    return { count: safeRecords.length };
  }
  const json = JSON.stringify(
    { exportedAt: new Date().toISOString(), items: safeRecords },
    null,
    2
  );
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `liquifact-invoice-detail-${Date.now()}.json`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return { count: safeRecords.length };
}

/**
 * Default delete — resolves with the deleted count. Parent owns list mutation.
 *
 * @param {Set<string>|Array<string>} ids
 * @returns {Promise<{ count: number }>}
 */
// eslint-disable-next-line no-unused-vars
export async function defaultDetailBulkDelete(ids) {
  const count = ids instanceof Set ? ids.size : Array.isArray(ids) ? ids.length : 0;
  return { count };
}

/**
 * @param {object} props
 * @param {Array<{id:string,name:string,kind?:string,issuer?:string}>} props.initialItems
 * @param {(ids: Set<string>) => Promise<{count?: number}>} [props.onBulkDelete]
 * @param {(items: Array<object>) => {count?: number}} [props.onBulkExport]
 * @param {{ success?: (msg: string, title?: string) => void, error?: (msg: string, title?: string) => void, info?: (msg: string, title?: string) => void }} [props.toast]
 */
export default function InvoiceDetailItems({
  initialItems = [],
  onBulkDelete = defaultDetailBulkDelete,
  // eslint-disable-next-line no-unused-vars
  onBulkExport = defaultDetailBulkExport,
  toast: toastApi = null,
}) {
  const [items, setItems] = useState(() => sanitizeDetailItems(initialItems).items);
  const [pendingDeleteIds, setPendingDeleteIds] = useState(null);
  const [bulkRunning, setBulkRunning] = useState({ export: false, delete: false });
  const [deleteInFlight, setDeleteInFlight] = useState(false);

  const reportRejected = useCallback(
    (rejected) => {
      if (rejected > 0) {
        toastApi?.info?.(
          bulkLabels.invalidItemsMsg.replace("{count}", String(rejected)),
          bulkLabels.invalidItemsTitle
        );
      }
    },
    [toastApi]
  );

  // Report initial sanitization once on mount.
  const [initialReportDone, setInitialReportDone] = useState(false);
  if (!initialReportDone) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    setInitialReportDone(true);
    const { rejected } = sanitizeDetailItems(initialItems);
    reportRejected(rejected);
  }

  /**
   * Concurrency guards.
   *
   * `deleteInFlightRef` prevents duplicate delete work when the confirm
   * handler is invoked more than once (double-click, retry, or a second
   * dialog confirmation racing the first). The ref is the source of truth
   * for "is a delete currently executing" so that stale React state cannot
   * allow a second concurrent run.
   *
   * `deleteRunIdRef` is a monotonically increasing token. Each delete run
   * captures the current token; when the async work resolves, the run only
   * commits its state mutation if its token is still the latest. This makes
   * late-resolving runs idempotent and prevents them from clobbering newer
   * state (e.g. items re-added by the parent between runs).
   */
  const deleteInFlightRef = useRef(false);
  const deleteRunIdRef = useRef(0);

  const {
    selectedIds,
    selectedCount,
    visibleCount,
    allState,
    isSelected,
    toggle,
    selectAll,
    clear,
  } = useBulkSelection(items);

  const handleToggleSelectAll = useCallback(() => {
    if (allState === ALL_STATES.ALL) {
      clear();
    } else {
      selectAll();
    }
  }, [allState, clear, selectAll]);

  const handleRequestDelete = useCallback(() => {
    if (deleteInFlight) return;
    if (selectedIds.size === 0) return;
    setPendingDeleteIds(new Set(selectedIds));
  }, [selectedIds, deleteInFlight]);

  // eslint-disable-next-line no-unused-vars
  const handleCancelDelete = useCallback(() => {
    setPendingDeleteIds(null);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    const idsToDelete = pendingDeleteIds;
    if (!idsToDelete || idsToDelete.size === 0) {
      setPendingDeleteIds(null);
      return;
    }
    // Guard against concurrent/repeated execution. If a delete is already
    // in flight, ignore this invocation entirely so we never issue duplicate
    // destructive work or double-apply state transitions.
    if (deleteInFlightRef.current) {
      return;
    }
    deleteInFlightRef.current = true;
    const runId = ++deleteRunIdRef.current;
    // Snapshot the ids for this run so later mutations of `pendingDeleteIds`
    // cannot change what this invocation deletes.
    const idsSnapshot = new Set(idsToDelete);
    setBulkRunning((prev) => ({ ...prev, delete: true }));
    try {
      await onBulkDelete(idsSnapshot);
      // Only the latest run may commit state. A superseded run is a no-op
      // so retries and races cannot produce inconsistent results.
      if (runId !== deleteRunIdRef.current) {
        return;
      }
      setItems((current) => current.filter((item) => !idsSnapshot.has(item.id)));
      const plural = idsSnapshot.size === 1 ? "" : "s";
      toastApi?.success?.(
        bulkLabels.deleteSuccessMsg
          .replace("{count}", String(idsSnapshot.size))
          .replace("{plural}", plural),
        bulkLabels.deleteSuccessTitle
      );
      setPendingDeleteIds(null);
    } catch {
      if (runId === deleteRunIdRef.current) {
        toastApi?.error?.(bulkLabels.deleteErrorMsg, bulkLabels.deleteErrorTitle);
      }
    } finally {
      if (runId === deleteRunIdRef.current) {
        setBulkRunning((prev) => ({ ...prev, delete: false }));
      }
      deleteInFlightRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDeleteIds, onBulkDelete, toastApi, deleteInFlight]);

  const handleExport = useCallback(() => {
    if (selectedIds.size === 0) {
      toastApi?.info?.(bulkLabels.exportEmptyMsg, bulkLabels.exportSuccessTitle);
      return;
    }
    if (bulkRunning.export) return;
    setBulkRunning((prev) => ({ ...prev, export: true }));
    try {
      const selectedSlice = items.filter((item) => selectedIds.has(item.id));
      const result = onBulkExport(selectedSlice) || { count: selectedSlice.length };
      const exportCount = result.count ?? selectedSlice.length;
      const plural = exportCount === 1 ? "" : "s";
      toastApi?.success?.(
        bulkLabels.exportSuccessMsg
          .replace("{count}", String(exportCount))
          .replace("{plural}", plural),
        bulkLabels.exportSuccessTitle
      );
    } finally {
      setBulkRunning((prev) => ({ ...prev, export: false }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, items, onBulkExport, toastApi, bulkRunning.export]);

  if (items.length === 0) {
    return null;
  }

  const deleteDialogOpen = pendingDeleteIds !== null;

  // eslint-disable-next-line react/jsx-no-useless-fragment
  return (
    <section
      aria-labelledby="invoice-detail-items-heading"
      className="no-print mb-6 rounded-xl border border-slate-800 bg-slate-900/50 p-6"
      data-testid="invoice-detail-items"
    >
      <h2 id="invoice-detail-items-heading" className="text-base font-semibold text-slate-100 mb-4">
        {bulkLabels.sectionHeading}
      </h2>
      <p className="text-sm text-slate-400 mb-4">{bulkLabels.sectionSub}</p>

      <BulkActionsToolbar
        selectedCount={selectedCount}
        visibleCount={visibleCount}
        allState={allState}
        onToggleSelectAll={handleToggleSelectAll}
        onClearSelection={clear}
        onExport={handleExport}
        onRequestDelete={handleRequestDelete}
        labels={bulkLabels}
        exporting={bulkRunning.export}
        deleting={bulkRunning.delete}
      />

      <ul aria-label={bulkLabels.listAriaLabel} className="space-y-3">
        {items.map((item) => {
          const checked = isSelected(item.id);
          // eslint-disable-next-line no-unused-vars
          const checkboxAria = bulkLabels.rowCheckboxAria
            .replace("{name}", item.name)
            .replace("{id}", item.id);
          return (
            <li
              key={item.id}
              data-testid={`detail-item-row-${item.id}`}
              data-selected={checked ? "true" : "false"}
              className={[
                "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                checked ? "border-cyan-700/60 bg-cyan-950/30" : "border-slate-800 bg-slate-950/40",
              ].join(" ")}
            >
              <label className="inline-flex items-center gap-3 cursor-pointer min-w-0 flex-1">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(item.id)}
                  aria-label={checkboxAria}
                  data-testid={`detail-item-checkbox-${item.id}`}
                  className="h-4 w-4 flex-shrink-0 rounded border-slate-600 bg-slate-900 text-cyan-500 accent-cyan-400 focus-ring"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-100 truncate">
                    {item.name}
                  </span>
                  <span className="block text-xs text-slate-500 truncate">{item.id}</span>
                </span>
              </label>
              <span className="text-xs uppercase tracking-wide text-slate-500 flex-shrink-0">
                {item.kind || "document"}
              </span>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={deleteDialogOpen}
        onClose={handleCancelDelete}
        // eslint-disable-next-line no-unused-vars
        onConfirm={handleConfirmDelete}
        title={bulkLabels.deleteConfirmTitle}
        description={
          pendingDeleteIds
            ? bulkLabels.deleteConfirmBody
                .replace("{count}", String(pendingDeleteIds.size))
                .replace("{plural}", pendingDeleteIds.size === 1 ? "" : "s")
            : ""
        }
        confirmLabel={
          pendingDeleteIds
            ? bulkLabels.deleteConfirmConfirmLabel
                .replace("{count}", String(pendingDeleteIds.size))
                .replace("{plural}", pendingDeleteIds.size === 1 ? "" : "s")
            : "Delete"
        }
        cancelLabel={bulkLabels.deleteConfirmCancelLabel}
        variant="danger"
        confirmLoading={bulkRunning.delete}
      />
    </section>
  );
}
