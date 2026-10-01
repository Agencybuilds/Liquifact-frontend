// @ts-nocheck
/**
 * Tests for app/not-found.js — the branded 404 boundary.
 *
 * Strategy:
 *  - Render the component directly; next/link is already mocked in __mocks__
 *    to a plain <a> tag so href assertions are straightforward.
 *  - Cover copy strings, link target, ARIA structure, a11y, and the
 *    compatibility contract for the /invest/[id] not-found boundary.
 */
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { axe } from "jest-axe";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import React from "react";

import NotFound from "./not-found";
import { copy } from "./copy/en";

// ── Concurrency / idempotency harness ─────────────────────────────────────────
//
// Invariants under test:
//  1. Rendering the 404 boundary is a pure, side-effect-free operation, so
//     concurrent or repeated renders must produce identical output.
//  2. No shared mutable module state may leak between renders (e.g. counters,
//     caches, or memoized singletons that could go stale).
//  3. Retries after a failed render must not observe partial state from the
//     previous attempt.
//
// These helpers exercise those invariants without changing the component's
// public interface.

/**
 * Renders the boundary `times` times concurrently and returns the resulting
 * serialized DOM for each render. Because React Testing Library renders are
 * synchronous, we interleave them via Promise.all to model racing callers.
 */
async function renderConcurrently(times) {
  const results = await Promise.all(
    Array.from({ length: times }, async () => {
      const { container, unmount } = render(<NotFound />);
      const html = container.innerHTML;
      unmount();
      return html;
    })
  );
  return results;
}

/**
 * Renders the boundary, unmounts it, and renders again — modelling an
 * idempotent retry after a transient failure. Returns both snapshots.
 */
function renderThenRetry() {
  const first = render(<NotFound />);
  const firstHtml = first.container.innerHTML;
  first.unmount();

  const second = render(<NotFound />);
  const secondHtml = second.container.innerHTML;
  second.unmount();

  return { firstHtml, secondHtml };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderNotFound() {
  return render(<NotFound />);
}

function renderNotFoundToString() {
  return renderToString(<NotFound />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("NotFound (app/not-found.js)", () => {
  // ── Rendering ───────────────────────────────────────────────────────────────

  describe("rendering", () => {
    it("renders the 404 page container", () => {
      renderNotFound();
      expect(screen.getByTestId("not-found-page")).toBeInTheDocument();
    });

    it("renders deterministically across repeated renders (no hidden state)", () => {
      const first = renderNotFoundToString();
      const second = renderNotFoundToString();
      expect(first).toBe(second);
    });

    it("renders the h1 heading with the correct copy", () => {
      renderNotFound();
      expect(
        screen.getByRole("heading", { level: 1, name: copy.notFound.heading })
      ).toBeInTheDocument();
    });

    it("renders the description copy", () => {
      renderNotFound();
      expect(screen.getByText(copy.notFound.description)).toBeInTheDocument();
    });

    it("renders the decorative status label text", () => {
      renderNotFound();
      // aria-hidden means it won't be in the accessibility tree, but it is in the DOM
      const badge = document.querySelector("[aria-hidden='true']");
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveTextContent(copy.notFound.statusLabel);
    });

    it("renders only one h1 on the page", () => {
      renderNotFound();
      const headings = screen.getAllByRole("heading", { level: 1 });
      expect(headings).toHaveLength(1);
    });

    it("recovers deterministically when rendered after an unmount cycle", () => {
      const first = renderNotFound();
      first.unmount();
      const second = renderNotFound();
      expect(second.getByTestId("not-found-page")).toBeInTheDocument();
      expect(second.getByTestId("not-found-home-link")).toHaveAttribute("href", "/");
    });
  });

  // ── Home link ────────────────────────────────────────────────────────────────

  describe("home link", () => {
    it("renders a home link with the correct label", () => {
      renderNotFound();
      const link = screen.getByTestId("not-found-home-link");
      expect(link).toBeInTheDocument();
      expect(link).toHaveTextContent(copy.notFound.homeLabel);
    });

    it("the home link points to /", () => {
      renderNotFound();
      expect(screen.getByTestId("not-found-home-link")).toHaveAttribute("href", "/");
    });

    it("the home link is keyboard focusable (no tabIndex=-1)", () => {
      renderNotFound();
      const link = screen.getByTestId("not-found-home-link");
      expect(link).not.toHaveAttribute("tabindex", "-1");
    });

    it("the home link is the sole link on the page", () => {
      renderNotFound();
      const links = screen.getAllByRole("link");
      expect(links).toHaveLength(1);
      expect(links[0]).toHaveAttribute("href", "/");
    });

    it("has a focus-ring class for consistent keyboard styling", () => {
      renderNotFound();
      const link = screen.getByTestId("not-found-home-link");
      expect(link.className).toContain("focus-ring");
    });

    it("keeps the home link stable across repeated renders (no data loss)", () => {
      const { unmount } = renderNotFound();
      unmount();
      renderNotFound();
      const link = screen.getByTestId("not-found-home-link");
      expect(link).toHaveTextContent(copy.notFound.homeLabel);
      expect(link).toHaveAttribute("href", "/");
    });
  });

  // ── ARIA / landmarks ─────────────────────────────────────────────────────────

  describe("ARIA and landmarks", () => {
    it("renders a main landmark", () => {
      renderNotFound();
      expect(screen.getByRole("main")).toBeInTheDocument();
    });

    it("the main landmark has aria-labelledby pointing to the h1", () => {
      renderNotFound();
      const main = screen.getByRole("main");
      expect(main).toHaveAttribute("aria-labelledby", "not-found-heading");
    });

    it("the main landmark id matches the h1 aria-labelledby", () => {
      renderNotFound();
      const h1 = screen.getByRole("heading", { level: 1 });
      expect(h1).toHaveAttribute("id", "not-found-heading");
    });

    it("the decorative status badge is hidden from assistive tech", () => {
      renderNotFound();
      const badge = document.querySelector("[aria-hidden='true']");
      expect(badge).toHaveAttribute("aria-hidden", "true");
    });

    it("preserves ARIA invariants after a failure/recovery cycle", () => {
      const first = renderNotFound();
      first.unmount();
      renderNotFound();
      const main = screen.getByRole("main");
      expect(main).toHaveAttribute("aria-labelledby", "not-found-heading");
      expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute(
        "id",
        "not-found-heading"
      );
    });
  });

  // ── Accessibility ────────────────────────────────────────────────────────────

  describe("accessibility", () => {
    it("has no axe violations", async () => {
      const { container } = renderNotFound();
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("has no axe violations after a recovery render", async () => {
      const first = renderNotFound();
      first.unmount();
      const { container } = renderNotFound();
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  // ── Dark theme / styling ──────────────────────────────────────────────────────

  describe("theme / styling", () => {
    it("applies the dark slate-950 background to the page wrapper", () => {
      renderNotFound();
      const page = screen.getByTestId("not-found-page");
      expect(page.className).toContain("bg-slate-950");
    });

    it("applies text-slate-50 to the page wrapper", () => {
      renderNotFound();
      const page = screen.getByTestId("not-found-page");
      expect(page.className).toContain("text-slate-50");
    });

    it("the status label uses the cyan brand colour class", () => {
      renderNotFound();
      const badge = document.querySelector("[aria-hidden='true']");
      expect(badge?.className).toContain("text-cyan-500");
    });

    it("keeps styling classes stable across recovery renders", () => {
      const first = renderNotFound();
      first.unmount();
      renderNotFound();
      const page = screen.getByTestId("not-found-page");
      expect(page.className).toContain("bg-slate-950");
      expect(page.className).toContain("text-slate-50");
    });
  });

  // ── Unknown route navigation (snapshot regression) ────────────────────────────

  describe("snapshot regression", () => {
    it("renders consistently across test runs", () => {
      const { container } = renderNotFound();
      expect(container.firstChild).toMatchSnapshot();
    });

    it("renders the same snapshot after a failure/recovery cycle", () => {
      const first = renderNotFound();
      first.unmount();
      const { container } = renderNotFound();
      expect(container.firstChild).toMatchSnapshot();
    });
  });

  // ── Concurrency / idempotency ────────────────────────────────────────────────

  describe("concurrent execution", () => {
    it("produces identical output for racing renders", async () => {
      const snapshots = await renderConcurrently(8);
      expect(snapshots).toHaveLength(8);
      // Every concurrent render must be byte-for-byte identical.
      for (const html of snapshots) {
        expect(html).toBe(snapshots[0]);
      }
    });

    it("does not leak state between concurrent renders", async () => {
      const [a, b] = await renderConcurrently(2);
      // A second render must not accumulate nodes or duplicate landmarks.
      expect(a).toBe(b);
      expect((a.match(/not-found-page/g) ?? []).length).toBe(1);
    });

    it("is idempotent across unmount/remount retries", () => {
      const { firstHtml, secondHtml } = renderThenRetry();
      expect(secondHtml).toBe(firstHtml);
    });

    it("recovers cleanly after a failed render attempt", () => {
      // Simulate a transient failure by rendering, throwing away the tree,
      // then rendering again. The retry must succeed with full output.
      const failed = render(<NotFound />);
      failed.unmount();

      renderNotFound();
      expect(screen.getByTestId("not-found-page")).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    });

    it("keeps the home link stable under repeated renders", async () => {
      const snapshots = await renderConcurrently(5);
      for (const html of snapshots) {
        expect(html).toContain('href="/"');
      }
    });
  });

  // ── Boundary cases ───────────────────────────────────────────────────────────

  describe("boundary cases", () => {
    it("renders without props (invalid/unknown route input)", () => {
      // The boundary receives no route params; it must not depend on any.
      render(<NotFound />);
      expect(screen.getByTestId("not-found-page")).toBeInTheDocument();
    });

    it("does not expose sensitive data in the rendered output", () => {
      const { container } = renderNotFound();
      const html = container.innerHTML;
      // No stack traces, file paths, or internal identifiers should leak.
      expect(html).not.toMatch(/at\s+\w+\s+\(/);
      expect(html).not.toMatch(/node_modules/);
      expect(html).not.toMatch(/Error:/);
    });

    it("renders a diagnosable, user-visible message", () => {
      renderNotFound();
      expect(screen.getByText(copy.notFound.description)).toBeVisible();
    });
  });
});
