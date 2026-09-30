"use client";

/**
 * @file MarketplaceContext.jsx
 *
 * React Context that owns the invoice list state for the invest (marketplace)
 * routes.  It wraps both the list page (`/invest`) and the detail page
 * (`/invest/[id]`) so that optimistic updates applied on the detail page
 * (e.g. funding an invoice) are immediately visible when the user navigates
 * back to the list.
 *
 * The provider exposes:
 *   - `invoices`    — current invoice array (may be null while loading)
 *   - `setInvoices`   — setter for replacing the full list (used by the loader)
 *   - `pendingIds`    — Set of invoice ids with in-flight fund actions
 *   - `fundInvoice`   — orchestrates optimistic status update + server action +
 *                        rollback on failure with toast feedback
 *
 * Failure-recovery invariants:
 *   - Optimistic updates are applied atomically per invoice id.
 *   - Rollback restores the exact pre-action snapshot for that invoice only,
 *     so concurrent fund actions on other invoices are never clobbered.
 *   - Duplicate/concurrent fund calls for the same id are rejected by the
 *     underlying `fund` hook (pendingIds guard) and never mutate state twice.
 */

import { createContext, useCallback, useContext, useMemo } from "react";
import { useMarketplaceActions } from "@/lib/hooks/useMarketplaceActions";

const MarketplaceContext = createContext(null);

/**
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {Array|null} props.invoices   — invoice array managed by the parent
 * @param {Function} props.setInvoices  — setter to replace the full invoice list
 */
export function MarketplaceProvider({ children, invoices, setInvoices }) {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { pendingIds, fund } = useMarketplaceActions();

  /**
   * Fund an invoice with optimistic status change.
   *
   * 1. Optimistically flip the invoice's status to "Funded".
   * 2. Run the caller-provided async action.
   * 3. On success — the optimistic status stays (committed).
   * 4. On failure — the invoice reverts to its original status and the error
   *    is re-thrown so the caller can surface a toast.
   *
   * Determinism: the snapshot is captured from the latest `invoices` value
   * via a functional setter, so retries and concurrent updates cannot race
   * the rollback against a stale closure.
   *
   * @param {string}   invoiceId
   * @param {number}   amount
   * @param {Function} performAction — async (invoiceId, amount) => void
   * @returns {Promise<boolean>}
   */
  const fundInvoice = useCallback(
    // eslint-disable-next-line react-hooks/exhaustive-deps
    async (invoiceId, amount, performAction) => {
      return fund(invoiceId, amount, performAction, {
        optimisticUpdate: (id) => {
          // Snapshot must be captured from the latest state to remain
          // deterministic under concurrent updates and retries. We use a
          // functional setter so the snapshot and the optimistic flip are
          // derived from the same `prev` value.
          let snapshot = null;
          setInvoices((prev) => {
            if (!Array.isArray(prev)) return prev;
            const current = prev.find((inv) => inv.id === id) ?? null;
            snapshot = current ? { ...current } : null;
            if (!current) return prev;
            return prev.map((inv) =>
              inv.id === id ? { ...inv, status: "Funded" } : inv
            );
          });
          return snapshot;
        },
        rollback: (id, snapshot) => {
          if (!snapshot) return;
          // Restore only the affected invoice. Guard against clobbering a
          // newer committed state: if the invoice is no longer present
          // (e.g. list reloaded), skip the rollback rather than resurrect it.
          setInvoices((prev) => {
            if (!Array.isArray(prev)) return prev;
            const exists = prev.some((inv) => inv.id === id);
            if (!exists) return prev;
            return prev.map((inv) => (inv.id === id ? snapshot : inv));
          });
        },
      });
    },
    [fund, setInvoices]
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(
    () => ({
      invoices,
      setInvoices,
      pendingIds,
      fundInvoice,
    }),
    [invoices, setInvoices, pendingIds, fundInvoice]
  );

  return (
    <MarketplaceContext.Provider value={value}>
      {children}
    </MarketplaceContext.Provider>
  );
}

/**
 * Access marketplace invoice state and the optimistic fund action.
 *
 * @returns {{
 *   invoices: Array|null,
 *   setInvoices: Function,
 *   pendingIds: Set<string>,
 *   fundInvoice: (invoiceId: string, amount: number, performAction: () => Promise<void>) => Promise<boolean>
 * }}
 */
export function useMarketplace() {
  const ctx = useContext(MarketplaceContext);
  if (!ctx) {
    throw new Error("useMarketplace must be used within a MarketplaceProvider");
  }
  return ctx;
}
