"use client";

import { useEffect } from "react";
import ErrorBanner from "@/components/ErrorBanner";
import { copy } from "@/app/copy/en";

export function getInvestErrorMessage(error) {
  return error && typeof error.message === "string" && error.message.trim()
    ? error.message
    : copy.error?.description || "Please try again.";
}

export default function InvoiceDetailError({ error, reset }) {
  useEffect(() => {
    console.error("Invest route failed", error instanceof Error ? error.message : "Unknown error");
  }, [error]);

  const retry = typeof reset === "function" ? reset : () => window.location.reload();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <main className="max-w-4xl mx-auto py-12" id="main-content">
        <ErrorBanner variant="server" title={copy.error?.title || "Something went wrong"} description={getInvestErrorMessage(error)} actionLabel={copy.error?.actionLabel} onAction={retry} />
      </main>
    </div>
  );
}
