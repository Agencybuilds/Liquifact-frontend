"use client";

// @ts-check

import { useEffect } from "react";
import ErrorBanner from "@/components/ErrorBanner";
import { copy } from "@/app/copy/en";

const DEFAULT_TITLE = copy.error?.title || "Something went wrong";
const DEFAULT_DESCRIPTION = copy.error?.description || "An unexpected error occurred. Please try again.";

/** @param {unknown} message */
const isSafeMessage = (message) =>
  typeof message === "string" && message.trim().length > 0;

/** @param {unknown} error */
const getSafeDescription = (error) => {
  const message = error && typeof error === "object" ? error.message : undefined;

  if (!isSafeMessage(message)) {
    return DEFAULT_DESCRIPTION;
  }

  return message;
};

/** @param {{ error: Error & { message?: string }, reset: () => void }} props */
export default function InvoiceDetailError({ error, reset }) {
  useEffect(() => {
    // Error reporting could be placed here.
    console.error(error);
  }, [error]);

  const description = getSafeDescription(error);

  /** @type {boolean} */
  const canReset = typeof reset === "function";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-6">
      <main className="max-w-4xl mx-auto py-12" id="main-content">
        <ErrorBanner
          variant="server"
          title={DEFAULT_TITLE}
          description={description}
          actionLabel={canReset ? copy.error?.actionLabel : undefined}
          onAction={canReset ? reset : undefined}
        />
      </main>
    </div>
  );
}
