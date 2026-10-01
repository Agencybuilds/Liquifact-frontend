import Link from "next/link";
import { copy } from "./copy/en";

/**
 * App Router not-found boundary.
 *
 * Rendered automatically by Next.js when {@link notFound} is called anywhere
 * in the segment tree, or when no matching route is found for an incoming URL.
 * Provides a branded 404 page consistent with the dark slate/cyan theme used
 * across the rest of the application.
 *
 * Determinism / recovery invariants:
 * - This boundary is a pure, side-effect-free render. It must never throw,
 *   fetch, read from storage, or depend on ambient mutable state. Any failure
 *   here would cascade into an unrecoverable error boundary and lose the
 *   user's ability to recover navigation.
 * - Copy lookups are defensively normalized so a missing or partially
 *   translated `copy.notFound` object cannot crash the boundary. Missing keys
 *   fall back to deterministic English defaults rather than throwing.
 * - The recovery link is always rendered and always points to a static home
 *   route, so the user can always escape the 404 state even if copy is
 *   degraded.
 *
 * Accessibility notes:
 * - The page has a single `<h1>` so heading structure is clear.
 * - The "Back to LiquiFact" link is the first interactive element and is fully
 *   keyboard-navigable via the `.focus-ring` utility class.
 * - The decorative "404" badge is hidden from assistive technologies with
 *   `aria-hidden` — the visible `<h1>` provides the meaningful heading.
 */

/**
 * Deterministic fallback copy. Used when the locale bundle is missing or
 * partially defined, ensuring the 404 boundary always renders useful content
 * instead of throwing and cascading into a fatal error state.
 */
const FALLBACK_NOT_FOUND = Object.freeze({
  statusLabel: "404",
  heading: "Page not found",
  description: "The page you are looking for does not exist or may have been moved.",
  homeLabel: "Back to LiquiFact",
});

/**
 * Resolve a not-found copy field deterministically.
 *
 * Only non-empty string values are accepted from the locale bundle. Every
 * other case (missing key, wrong type, empty string, or a throwing getter)
 * falls back to the frozen English default. This keeps the render pure and
 * side-effect-free while guaranteeing user-visible content in all cases.
 *
 * @param {"statusLabel" | "heading" | "description" | "homeLabel"} key
 * @returns {string}
 */
function resolveCopy(key) {
  try {
    const value = copy?.notFound?.[[key]];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  } catch {
    // Defensive: a throwing getter or malformed bundle must not break the
    // boundary. Fall through to the deterministic default.
  }
  return FALLBACK_NOT_FOUND[key];
}

export default function NotFound() {
  const statusLabel = resolveCopy("statusLabel");
  const heading = resolveCopy("heading");
  const description = resolveCopy("description");
  const homeLabel = resolveCopy("homeLabel");

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 py-16 text-slate-50"
      data-testid="not-found-page"
    >
      <main
        id="main-content"
        className="w-full max-w-lg text-center"
        aria-labelledby="not-found-heading"
      >
        {/* Decorative status code — hidden from screen readers */}
        <p
          aria-hidden="true"
          className="mb-4 text-8xl font-extrabold tracking-tight text-cyan-500/30 select-none"
        >
          {statusLabel}
        </p>

        <h1 id="not-found-heading" className="mb-4 text-3xl font-bold tracking-tight text-slate-50">
          {heading}
        </h1>

        <p className="mb-8 text-base leading-7 text-slate-400">{description}</p>

        <Link
          href="/"
          className="focus-ring inline-flex items-center justify-center rounded-full bg-cyan-500/20 px-6 py-3 text-sm font-medium text-cyan-400 transition-colors duration-200 hover:bg-cyan-500/30 active:bg-cyan-500/40"
          data-testid="not-found-home-link"
        >
          {homeLabel}
        </Link>
      </main>
    </div>
  );
}
