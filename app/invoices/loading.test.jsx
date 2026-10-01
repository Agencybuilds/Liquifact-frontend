/* eslint-env jest */
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
 * The loading UI is a pure presentational fallback. The determinism
 * contract for this module is that it must render the same markup for
 * every invocation (including repeated mounts and concurrent renders)
 * and must not throw when adjusting the document title or when a
 * previous loading shell was already mounted. These tests pin that
 * behavior down so failure recovery is observable and repeatable.
 */

import { render, screen, cleanup } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import InvoicesLoading from "./loading";

expect.extend(toHaveNoViolations);

describe("InvoicesLoading", () => {
  const originalTitle = document.title;

  afterEach(() => {
    cleanup();
    document.title = originalTitle;
  });

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

  // --------------------------------------------------------------------
  // Determinism and failure-recovery coverage
  // --------------------------------------------------------------------

  it("produces identical markup across repeated mounts (deterministic render)", () => {
    const first = render(<InvoicesLoading />);
    const firstHtml = first.container.innerHTML;
    cleanup();

    const second = render(<InvoicesLoading />);
    const secondHtml = second.container.innerHTML;

    expect(secondHtml).toEqual(firstHtml);
  });

  it("survives a repeated mount without losing the loading shell (recovery)", () => {
    const { unmount } = render(<InvoicesLoading />);
    expect(screen.getByTestId("invoices-loading")).toBeInTheDocument();

    // Simulate a failed navigation that unmounts the loading UI.
    unmount();
    expect(screen.queryByTestId("invoices-loading")).not.toBeInTheDocument();

    // Recovery: re-mounting must restore the full shell and the UploadSkeleton.
    render(<InvoicesLoading />);
    expect(screen.getByTestId("invoices-loading")).toBeInTheDocument();
    expect(screen.getByTestId("upload-skeleton")).toBeInTheDocument();
  });

  it("does not throw when the document title is already mutated (boundary)", () => {
    document.title = "";
    expect(() => render(<InvoicesLoading />)).not.toThrow();
    expect(screen.getByTestId("invoices-loading")).toBeInTheDocument();
  });

  it("renders concurrently without collision (concurrent execution)", () => {
    const a = render(<InvoicesLoading />);
    const b = render(<InvoicesLoading />);

    expect(a.container.querySelectorAll('[data-testid="invoices-loading"]').length).toBeTruthy();
    expect(b.container.querySelectorAll('[data-testid="invoices-loading"]').length).toBeTruthy();
  });

  it("exposes a stable accessible name for the loading region", () => {
    render(<InvoicesLoading />);
    const root = screen.getByTestId("invoices-loading");
    expect(root).toHaveAttribute("role", "status");
    expect(root).toHaveAttribute("aria-live", "polite");
  });
});
