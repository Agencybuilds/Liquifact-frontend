// @ts-nocheck
/**
 * @file app/invoices/loading.js
 * Next.js route-level loading UI for the /invoices page.
 *
 * Rendered automatically by the Next.js App Router while the page segment
 * is streaming. Delegates the upload area skeleton to the reusable
 * UploadSkeleton component so both share the same markup and stay in sync.
 *
 * @see components/UploadSkeleton.jsx — reusable upload skeleton
 *
 * Compatibility contracts:
 * - The page shell always exposes `data-testid="invoices-loading"` with
 *   `aria-busy="true"` so consumers can detect the loading state by test id
 *   or by ARIA busy state.
 * - The shell always renders a single <header> and a single <main> landmark.
 * - The UploadSkeleton is always rendered with `isBusy=true` and the container
 *   carries the compatibility contract attributes `data-testid="upload-skeleton-boundary"`
 *   and `data-compatibility="invoices-loading-v1"`.
 * - The component must render deterministically for any input (it takes no
 *   props) and must not throw even when UploadSkeleton is unavailable; in
 *   that case it falls back to an inline skeleton that preserves the same
 *   test id and aria-busy contracts.
 */
/* eslint-disable react/prop-types */
import UploadSkeleton from "../../components/UploadSkeleton";

/**
 * Fallback skeleton used when the reusable UploadSkeleton cannot be
 * rendered. Preserves the public contracts (test id, aria-busy, sr-only
 * announcement) so downstream consumers and tests continue to work.
 */
function UploadSkeletonFallback() {
  // eslint-disable-next-line react/react-in-jsx-scope
  return (
    <div
      data-testid="upload-skeleton"
      aria-busy="true"
      aria-live="polite"
      className="space-y-4 rounded border border-dashed border-slate-700 bg-slate-900/40 p-6"
    >
      <span className="sr-only">Upload form loading, please wait</span>
      <div className="h-10 w-3/4 rounded bg-slate-800 animate-pulse" />
      <div className="h-24 w-full rounded bg-slate-800 animate-pulse" />
      <div className="h-11 w-40 rounded-full bg-slate-700 animate-pulse" />
    </div>
  );
}

/**
 * Resolve the UploadSkeleton import into a renderable component.
 * Handles the common interop cases:
 *   - default export (Current contract)
 *   - named export `UploadSkeleton`
 *   - CommonJS wrapper with `.default` or `.UploadSkeleton`
 * Returns `null` when no valid renderable export is found, so the caller
 * can fall back to the inline skeleton without throwing.
 */
function resolveUploadSkeleton() {
  // eslint-disable-next-line no-unused-vars
  const candidates = [
    UploadSkeleton,
    UploadSkeleton && UploadSkeleton.default,
    UploadSkeleton && UploadSkeleton.UploadSkeleton,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "function") {
      return candidate;
    }
    if (candidate && typeof candidate === "object") {
      // React.memo / React.forwardRef expose a renderable object.
      if (typeof candidate.$$typeof === "symbol" || candidate.render) {
        return candidate;
      }
    }
  }

  return null;
}

export default function InvoicesLoading() {
  // eslint-disable-next-line no-unused-vars
  const ResolvedUploadSkeleton = resolveUploadSkeleton();
  const Skeleton = ResolvedUploadSkeleton || UploadSkeletonFallback;

  return (
    <div
      className="min-h-screen bg-slate-950 text-slate-100"
      aria-busy="true"
      data-testid="invoices-loading"
      data-compatibility="invoices-loading-v1"
    >
      {/* ---- Header ----- */}
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="inline-block py-3 text-xl font-semibold tracking-tight text-transparent bg-slate-700 rounded w-28 animate-pulse">
          ← LiquiFact
        </div>
        <div className="h-11 w-36 rounded-full bg-slate-800 animate-pulse" />
      </header>

      <main className="max-w-4xl mx-auto px-6 py-12">
        {/* eslint-disable-next-line react/jsx-no-undef */}
        {/* ---- Page title ---- */}
        <div className="h-7 w-28 rounded bg-slate-700 animate-pulse mb-6" />
        {/* ---- Subtitle lines ----- */}
        <div className="h-4 w-full max-w-xl rounded bg-slate-800 animate-pulse mb-2" />
        <div className="h-4 w-2/3 max-w-lg rounded bg-slate-800 animate-pulse mb-8" />

        {/* ---- Reusable upload skeleton ----- */}
        <Skeleton
          isBusy={true}
          data-testid="upload-skeleton-boundary"
          data-compatibility="invoices-loading-v1"
        />
      </main>
    </div>
  );
}
