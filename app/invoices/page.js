"use client";
import React, { useCallback, useState } from "react";
import { copy } from "../copy/en";
import NavMenu from "../../components/NavMenu";
import UploadZone from "../../components/UploadZone";
import UploadErrorBoundary from "../../components/UploadErrorBoundary";
import InvoiceList from "../../components/InvoiceList";

export default function InvoicesPage() {
  const [optimisticInvoices, setOptimisticInvoices] = useState([]);

  // Compatibility contract: `onUploadSuccess` may be invoked with a single
  // invoice object (legacy callers) or an array of invoices (batched uploads).
  // We normalize both shapes, ignore malformed/empty payloads, and de-duplicate
  // by `id` so retries or concurrent uploads cannot create duplicate rows.
  const handleUploadSuccess = useCallback((payload) => {
    const incoming = Array.isArray(payload) ? payload : [payload];
    const valid = incoming.filter(
      (invoice) =>
        invoice &&
        typeof invoice === "object" &&
        invoice.id !== undefined &&
        invoice.id !== null
    );

    if (valid.length === 0) {
      return;
    }

    setOptimisticInvoices((current) => {
      const seen = new Set(current.map((invoice) => invoice.id));
      const additions = [];

      for (const invoice of valid) {
        if (seen.has(invoice.id)) {
          continue;
        }
        seen.add(invoice.id);
        additions.push(invoice);
      }

      if (additions.length === 0) {
        return current;
      }

      return [...additions, ...current];
    });
  }, []);

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
            <InvoiceList optimisticInvoices={optimisticInvoices} />
          </div>
        </div>
      </main>
    </div>
  );
}
