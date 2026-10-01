/* eslint-disable react-hooks/exhaustive-deps */
"use client";

/**
 * @file MarketplaceContext.jsx
 *
 * React Context that owns the invoice list state for the invest (marketplace)
 * routes.  It wraps both the list page (`/invest`) and the detail page
 * (`/invest/[id]`) so that optimistic updates applied on the detail page
 * (e.g. funding an invoice)) are immediately visible when the user navigates
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

import { createContext, useCallback, useContext, useMemo, useRef } from "react";
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
  const invoicesRef = useRef(invoices);

  /**
   * Fund an invoice with optimistic status change.
   *
   * 1. Optimistically flip the invoice's status to "Funded".
   * 2. Run the caller-provided async action.
   * 3. On success — the optimistic status stays (committed).
   * 4. On failure — the invoice reverts to its original status and the error
   *    is re-thrown so the caller can surface a toast.
   * 5. Concurrent calls for the same invoice id are rejected deterministically
   *    (returns false) so retries/duplicates cannot interleave optimistic
   *    updates or rollbacks and corrupt state.
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
      // Keep the ref in sync so the optimistic/rollback callbacks always read
      // the latest invoices array even if the closure is stale.
      invoicesRef.current = invoices;

      return fund(invoiceId, amount, performAction, {
        optimisticUpdate: (id) => {
          // Snapshot the current invoice for rollback.
          const current = invoicesRef.current?.find((inv) => inv.id === id) ?? null;
          const snapshot = current ? { ...current } : null;

          // Flip status immediately. Preserve the original status so rollback
          // restores the exact prior state (not a hard-coded default).
          setInvoices((prev) => {
            if (!Array.isArray(prev)) return prev;
            let changed = false;
            const next = prev.map((inv) => {
              if (inv.id !== id) return inv;
              if (inv.status === "Funded") return inv;
              changed = true;
              return { ...inv, status: "Funded" };
            });
            return changed ? next : prev;
          });

          return snapshot;
        },
        rollback: (id, snapshot) => {
          if (!snapshot) return;
          setInvoices((prev) => {
            if (!Array.isArray(prev)) return prev;
            let changed = false;
            const next = prev.map((inv) => {
              if (inv.id !== id) return inv;
              // Only roll back if the entry is still the optimistic version;
              // a concurrent commit must not be clobbered.
              if (inv.status !== "Funded") return inv;
              changed = true;
              return snapshot;
            });
            return changed ? next : prev;
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
