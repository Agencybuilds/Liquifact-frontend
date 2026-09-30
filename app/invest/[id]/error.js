"use client";

import { useEffect, useRef } from "react";
import ErrorBanner from "@/components/ErrorBanner";
import { copy } from "@/app/copy/en";

export default function InvoiceDetailError({ error, reset }) {
  const reportedRef = useRef(new WeakSet());
  const resettingRef = useRef(false);
  const resettingRef = useRef(false);

  useEffect(() => {
    // Dedupe reporting by error identity so repeated renders or concurrent
    // error boundary activations do not emit duplicate logs or metrics.
    if (!error || reportedRef.current.has(error)) {
      return;
    }
    reportedRef.current.add(error);
    // Error reporting could be placed here.
    console.error(error);
  }, [error]);

  // Idempotent reset: guard against concurrent or repeated invocations so a
  // double-click or racing retry cannot trigger overlapping recoveries.
  const handleReset = () => {
    if (resettingRef.current) {
      return;
    }
    resettingRef.current = true;
    try {
      reset();
    } finally {
      // Yield to the next microtask so the guard covers the entire reset
      // cycle without blocking future legitimate retries.
      Promise.resolve().then(() => {
        resettingRef.current = false;
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <main className="max-w-4xl mx-auto py-12" id="main-content">
        <ErrorBanner
          variant="server"
          title={copy.error?.title || "Something went wrong"}
          description={error?.message || copy.error?.description}
          actionLabel={copy.error?.actionLabel}
          onAction={handleReset}
        />
      </main>
    </div>
  );
}
