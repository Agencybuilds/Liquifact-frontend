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
 * State invariants owned by this boundary:
 * 1. This component is a pure, stateless render. It must not read or write
 *    mutable module-level state, mutate globals, or perform side effects.
 *    Therefore duplicate, concurrent, or retried renders are idempotent and
 *    cannot produce an inconsistent result.
 * 2. The render is deterministic for any input. The only external datum is
 *    the static {@link copy} object. The component accepts no props and
 *    derives no values from request-scoped inputs (search params, headers,
 *    cookies, time, randomness), so it cannot leak sensitive data or diverge
 *    between requests.
 * 3. The copy contract is validated at module load time. If a required
 *    string is missing or blank, the module fails fast with a clear,
 *    non-sensitive error rather than rendering a silently broken 404 page.
 *    This keeps the data-integrity invariant explicit and diagnosable.
 *
 * Accessibility notes:
 * - The page has a single `<h1>` so heading structure is clear.
 * - The "Back to LiquiFact" link is the first interactive element and is fully
 *   keyboard-navigable via the `.focus-ring` utility class.
 * - The decorative "404" badge is hidden from assistive technologies with
 *   `aria-hidden` — the visible `<h1>` provides the meaningful heading.
 */

/**
 * Required not-found copy keys. Keept in sync with the copy contract.
 * @type {readonly string[]}
 */
const REQUIRED_COPY_KEYS = Object.freeze([
  "statusLabel",
  "heading",
  "description",
  "homeLabel",
]);

/**
 * Validate the not-found copy contract and return a frozen, normalized view
 * model. This is executed once at module load so renders remain pure and
 * deterministic.
 *
 * Throws a descriptive error that contains only key names (no copy values,
 * no user data) when the contract is violated.
 *
 * @param {unknown} copyNotFound
 * @returns {{ statusLabel: string, heading: string, description: string, homeLabel: string }}
 */
export function validateNotFoundCopy(copyNotFound) {
  if (copyNotFound === null || typeof copyNotFound !== "object") {
    throw new Error(
      "not-found: `copy.notFound` must be an object with the required copy keys.",
    );
  }

  const missing = [];
  const normalized = {};

  for (const key of REQUIRED_COPY_KEYS) {
    const value = copyNotFound[key];
    if (typeof value !== "string" || value.trim() === "") {
      missing.push(key);
      continue;
    }
    normalized[key] = value;
  }

  if (missing.length > 0) {
    throw new Error(
      `not-found: missing or invalid copy keys: ${missing.join(", ")}.`,
    );
  }

  return Object.freeze(normalized);
}

/**
 * Frozen view model derived from the validated copy contract. Reading from a
 * frozen object guarantees the render output cannot be mutated after validation.
 * @type {Readonly<{ statusLabel: string, heading: string, description: string, homeLabel: string }>}
 */
const notFoundView = validateNotFoundCopy(copy?.notFound);

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
          {notFoundView.statusLabel}
        </p>

        <h1 id="not-found-heading" className="mb-4 text-3xl font-bold tracking-tight text-slate-50">
          {notFoundView.heading}
        </h1>

        <p className="mb-8 text-base leading-7 text-slate-400">{notFoundView.description}</p>

        <Link
          href="/"
          className="focus-ring inline-flex items-center justify-center rounded-full bg-cyan-500/20 px-6 py-3 text-sm font-medium text-cyan-400 transition-colors duration-200 hover:bg-cyan-500/30 active:bg-cyan-500/40"
          data-testid="not-found-home-link"
        >
          {notFoundView.homeLabel}
        </Link>
      </main>
    </div>
  );
}
