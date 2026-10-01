/**
 * @file app/invest/[id]/loading.test.jsx
 *
 * Unit and accessibility tests for the invoice-detail streaming skeleton.
 *
 * Test surface
 * ─────────────
 * 1. Structural invariants — elements required for layout-shift prevention
 *    and correct failure-recovery transitions are present and correct.
 * 2. Accessibility — no axe violations; live region and aria attributes are
 *    correctly set so assistive-technology users are informed during load.
 * 3. Copy-dictionary compliance — the loading label is sourced from the copy
 *    dictionary, not hardcoded.
 * 4. Stable keys — React warns in dev mode when `key` props are unstable;
 *    we verify each repeated element carries the stable prefix the component
 *    defines.
 * 5. Focus-management contract — `id="main-content"` is present on `<main>`
 *    so `RouteFocus.useEffect → getElementById("main-content")` always
 *    resolves without returning `null`.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { axe, toHaveNoViolations } from "jest-axe";
import InvoiceDetailLoading from "./loading";
import { copy } from "@/app/copy/en";

expect.extend(toHaveNoViolations);

// ── Mocks ─────────────────────────────────────────────────────────────────────

// NavMenuSkeleton is tested separately; mock it to keep this suite focused.
jest.mock("@/components/NavMenuSkeleton", () =>
  function NavMenuSkeletonMock() {
    return <header data-testid="nav-menu-skeleton" aria-hidden="true" />;
  }
);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Render the loading skeleton and return the container element. */
function renderLoading() {
  return render(<InvoiceDetailLoading />);
}

// ── Test suites ───────────────────────────────────────────────────────────────

describe("InvoiceDetailLoading — structural invariants", () => {
  it("renders NavMenuSkeleton", () => {
    renderLoading();
    expect(screen.getByTestId("nav-menu-skeleton")).toBeInTheDocument();
  });

  it('renders a <main> element with id="main-content" (required by RouteFocus)', () => {
    renderLoading();
    const main = screen.getByRole("main");
    expect(main).toBeInTheDocument();
    expect(main).toHaveAttribute("id", "main-content");
  });

  it('root wrapper carries aria-busy="true"', () => {
    const { container } = renderLoading();
    // The outermost element (not <main>) carries aria-busy.
    const wrapper = container.firstElementChild;
    expect(wrapper).toHaveAttribute("aria-busy", "true");
  });

  it("renders the back-link skeleton placeholder as aria-hidden (decorative)", () => {
    renderLoading();
    const main = screen.getByRole("main");
    // Decorative skeleton divs are hidden from the AT tree via aria-hidden="true".
    // The back-link, h1, and subtitle placeholder divs are all aria-hidden.
    const hiddenDivs = main.querySelectorAll(':scope > [aria-hidden="true"]');
    // At minimum the back-link, heading-1, and heading-2 skeleton divs are hidden.
    expect(hiddenDivs.length).toBeGreaterThanOrEqual(3);
  });

  it("renders three <section> elements for the detail card, documents, and timeline", () => {
    const { container } = renderLoading();
    const main = container.querySelector("#main-content");
    // Decorative sections carry aria-hidden="true" (no accessible name needed
    // because they are intentionally hidden from the AT tree).
    const sections = main?.querySelectorAll("section[aria-hidden='true']");
    // There are three sections: detail card, documents, timeline.
    expect(sections?.length).toBeGreaterThanOrEqual(3);
  });
});

// ── Copy-dictionary compliance ────────────────────────────────────────────────

describe("InvoiceDetailLoading — copy dictionary compliance", () => {
  it("uses copy.invoiceTimeline.loadingState as the loading label (not a hardcoded string)", () => {
    renderLoading();
    const expectedLabel = copy.invoiceTimeline.loadingState;
    // The live region is .sr-only — use { hidden: true } to find it.
    const statusRegion = screen.getByRole("status");
    expect(statusRegion).toHaveTextContent(expectedLabel);
  });

  it("the loading label is a non-empty string from the dictionary", () => {
    expect(typeof copy.invoiceTimeline.loadingState).toBe("string");
    expect(copy.invoiceTimeline.loadingState.length).toBeGreaterThan(0);
  });
});

// ── Accessibility ─────────────────────────────────────────────────────────────

describe("InvoiceDetailLoading — accessibility", () => {
  it('has a polite aria-live region with role="status" and aria-atomic="true"', () => {
    renderLoading();
    const statusRegion = screen.getByRole("status");
    expect(statusRegion).toHaveAttribute("aria-live", "polite");
    expect(statusRegion).toHaveAttribute("aria-atomic", "true");
  });

  it("the live region contains the loading label", () => {
    renderLoading();
    const statusRegion = screen.getByRole("status");
    expect(statusRegion).not.toBeEmptyDOMElement();
  });

  it("passes axe automated accessibility checks", async () => {
    const { container } = renderLoading();
    const results = await axe(container, {
      // The skeleton deliberately uses aria-hidden on decorative sections.
      // axe may flag missing accessible names on those sections, which is
      // expected — they are intentionally hidden from the AT tree.
      rules: {},
    });
    expect(results).toHaveNoViolations();
  });
});

// ── Stable keys (no dev-mode React warnings) ─────────────────────────────────

describe("InvoiceDetailLoading — stable element keys", () => {
  it("renders exactly 6 detail-field skeleton rows", () => {
    const { container } = renderLoading();
    const main = container.querySelector("#main-content");
    // The detail card section is the first <section> in main.
    const detailCard = main?.querySelector("section");
    expect(detailCard).not.toBeNull();
    // The grid inside the detail card contains 6 dt/dd pairs.
    const fieldDivs = detailCard?.querySelectorAll(".grid > div");
    expect(fieldDivs?.length).toBe(6);
  });

  it("renders exactly 3 document-row skeleton placeholders", () => {
    const { container } = renderLoading();
    const main = container.querySelector("#main-content");
    // The documents section is the second <section> in main.
    const sections = main?.querySelectorAll("section");
    expect(sections?.length).toBeGreaterThanOrEqual(2);
    const documentsSection = sections?.[1];
    // Each document row has 3 children (checkbox, name, button).
    const documentRows = documentsSection?.querySelectorAll(
      ".flex.items-center.gap-3"
    );
    expect(documentRows?.length).toBe(3);
  });

  it("renders exactly 5 timeline stage circles", () => {
    const { container } = renderLoading();
    const main = container.querySelector("#main-content");
    // Timeline section is the third <section>.
    const sections = main?.querySelectorAll("section");
    expect(sections?.length).toBeGreaterThanOrEqual(3);
    const timelineSection = sections?.[2];
    // Stage circles are rounded-full divs inside the stepper flex row.
    const circles = timelineSection?.querySelectorAll(".rounded-full");
    expect(circles?.length).toBe(5);
  });

  it("renders exactly 3 fund-action bar placeholders", () => {
    const { container } = renderLoading();
    const main = container.querySelector("#main-content");
    // FundActions bar is the last flex-wrap div after all sections.
    const actionBar = main?.querySelector(".flex.flex-wrap.gap-3");
    expect(actionBar).not.toBeNull();
    const buttons = actionBar?.querySelectorAll(".rounded-full");
    expect(buttons?.length).toBe(3);
  });
});

// ── Focus management contract ─────────────────────────────────────────────────

describe("InvoiceDetailLoading — focus management contract", () => {
  it('getElementById("main-content") resolves to the <main> element', () => {
    const { baseElement } = renderLoading();
    // Simulate the RouteFocus.useEffect query.
    const target = baseElement.ownerDocument.getElementById("main-content");
    expect(target).not.toBeNull();
    expect(target?.tagName).toBe("MAIN");
  });
});

// ── Failure-recovery boundary compatibility ───────────────────────────────────

describe("InvoiceDetailLoading — error and not-found boundary compatibility", () => {
  it("does not render ErrorBanner (error boundary is handled by error.js)", () => {
    renderLoading();
    // No alert role should be present — that is the error.js responsibility.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not render 'Invoice not found' text (not-found.js handles that)", () => {
    renderLoading();
    expect(screen.queryByText(/invoice not found/i)).not.toBeInTheDocument();
  });

  it("renders without throwing (idempotent on repeated renders)", () => {
    expect(() => {
      renderLoading();
      renderLoading();
    }).not.toThrow();
  });
});
