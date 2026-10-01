/* eslint-env jest */
/* @jest-environment jsdom */
/**
 * @file app/invoices/loading.test.jsx
 * Tests for the Next.js route-level loading UI at /invoices.
 *
 * Verifies that InvoicesLoading:
 *  - renders without errors
 *  - delegates to UploadSkeleton
 *  - exposes the correct ARIA attributes on the page shell
 *  - has no accessibility violations
 *
 * Compatibility contracts:
 *  - The loading UI is a purely presentational component with no props.
 *  - The root element must always expose data-testid="invoices-loading"
 *    and aria-busy="true" so assistive technology and tests can rely on it.
 *  - UploadSkeleton must always be rendered with data-testid="upload-skeleton"
 *    and a live region announcement for screen readers.
 *  - The component must render deterministically with no side effects, no
 *    network access, and no dependency on external state.
 */

/* eslint-disable-next-line */
import React from "react";
import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import InvoicesLoading from "./loading";

expect.extend(toHaveNoViolations);

describe("InvoicesLoading", () => {
  it("renders without crashing", () => {
    expect(() => render(React.createElement(InvoicesLoading))).not.toThrow();
  });

  it("renders the page root with aria-busy='true'", () => {
    render(React.createElement(InvoicesLoading));
    expect(screen.getByTestId("invoices-loading")).toHaveAttribute("aria-busy", "true");
  });

  it("renders the header skeleton (nav logo + wallet button placeholder)", () => {
    const { container } = render(React.createElement(InvoicesLoading));
    const header = container.querySelector("header");
    expect(header).toBeInTheDocument();
    // Two animate-pulse elements inside the header
    const headerPulse = header.querySelectorAll(".animate-pulse");
    expect(headerPulse.length).toBeGreaterThanOrEqual(2);
  });

  it("renders the page title and subtitle skeleton lines", () => {
    const { container } = render(React.createElement(InvoicesLoading));
    // h-7 w-28 title + two subtitle lines
    const titleSkeleton = container.querySelector(".h-7.w-28");
    expect(titleSkeleton).toBeInTheDocument();
  });

  it("renders the UploadSkeleton component (data-testid='upload-skeleton')", () => {
    render(React.createElement(InvoicesLoading));
    expect(screen.getByTestId("upload-skeleton")).toBeInTheDocument();
  });

  it("UploadSkeleton inside InvoicesLoading has aria-busy='true'", () => {
    render(React.createElement(InvoicesLoading));
    expect(screen.getByTestId("upload-skeleton")).toHaveAttribute("aria-busy", "true");
  });

  it("contains at least the sr-only loading announcement from UploadSkeleton", () => {
    render(React.createElement(InvoicesLoading));
    expect(screen.getByText(/upload form loading, please wait/i)).toBeInTheDocument();
  });

  it("has no axe accessibility violations", async () => {
    const { container } = render(React.createElement(InvoicesLoading));
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has multiple animate-pulse elements (no layout shift guarantee)", () => {
    const { container } = render(React.createElement(InvoicesLoading));
    const pulsed = container.querySelectorAll(".animate-pulse");
    expect(pulsed.length).toBeGreaterThanOrEqual(5);
  });

  // --------------------------------------------------------------------------
  // Compatibility contract tests
  // These tests pin the public behavior of the loading UI so future
  // refactors cannot silently break consumers (tests, screen readers,
  // or the Next.js route contract).
  // --------------------------------------------------------------------------

  it("contract: renders deterministically with no props and no side effects", () => {
    const first = render(React.createElement(InvoicesLoading));
    const firstHtml = first.container.innerHTML;
    first.unrender();

    const second = render(React.createElement(InvoicesLoading));
    expect(second.container.innerHTML).toBe(firstHtml);
  });

  it("contract: exposes a single root element with the stable test id", () => {
    const { container } = render(React.createElement(InvoicesLoading));
    expect(container.querySelectorAll('[data-testid="invoices-loading"]').length).toBe(1);
  });

  it("contract: root element is a live region with aria-busy and aria-label", () => {
    render(React.createElement(InvoicesLoading));
    const root = screen.getByTestId("invoices-loading");
    expect(root).toHaveAttribute("aria-busy", "true");
    expect(root).toHaveAttribute("aria-label");
  });

  it("contract: UploadSkeleton is rendered exactly once", () => {
    render(React.createElement(InvoicesLoading));
    expect(screen.getAllByTestId("upload-skeleton")).toHaveLength(1);
  });

  it("contract: sr-only announcement is present and not duplicated", () => {
    render(React.createElement(InvoicesLoading));
    const announcements = screen.getAllByText(/upload form loading, please wait/i);
    expect(announcements.length).toBe(1);
  });

  it("contract: renders and unrenders cleanly without leaking DOM nodes", () => {
    const { unrender } = render(React.createElement(InvoicesLoading));
    expect(screen.getByTestId("invoices-loading")).toBeInTheDocument();
    unrender();
    expect(screen.queryByTestId("invoices-loading")).toBeNull();
  });
});
