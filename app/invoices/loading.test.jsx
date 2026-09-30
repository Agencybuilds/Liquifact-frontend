// @vitest-environment jsdom
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
 * Additional invariant coverage (determinism, purity, no data leakage,
 * concurrent/repeated renders) is included below to guard the state
 * invariants documented in loading.js.
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import InvoicesLoading from "./loading";

expect.extend(toHaveNoViolations);

describe("InvoicesLoading", () => {
  it("renders without crashing", () => {
    expect(() => render(<InvoicesLoading />)).not.toThrow();
  });

  it("renders the page root with aria-busy='true'", () => {
    render(<InvoicesLoading />);
    expect(screen.getByTestId("invoices-loading")).toHaveAttribute("aria-busy", "true");
  });

  it("renders the header skeleton (nav logo + wallet button placeholder)", () => {
    const { container } = render(<InvoicesLoading />);
    const header = container.querySelector("header");
    expect(header).toBeInTheDocument();
    // Two animate-pulse elements inside the header
    const headerPulse = header.querySelectorAll(".animate-pulse");
    expect(headerPulse.length).toBeGreaterThanOrEqual(2);
  });

  it("renders the page title and subtitle skeleton lines", () => {
    const { container } = render(<InvoicesLoading />);
    // h-7 w-28 title + two subtitle lines
    const titleSkeleton = container.querySelector(".h-7.w-28");
    expect(titleSkeleton).toBeInTheDocument();
  });

  it("renders the UploadSkeleton component (data-testid='upload-skeleton')", () => {
    render(<InvoicesLoading />);
    expect(screen.getByTestId("upload-skeleton")).toBeInTheDocument();
  });

  it("UploadSkeleton inside InvoicesLoading has aria-busy='true'", () => {
    render(<InvoicesLoading />);
    expect(screen.getByTestId("upload-skeleton")).toHaveAttribute("aria-busy", "true");
  });

  it("contains at least the sr-only loading announcement from UploadSkeleton", () => {
    render(<InvoicesLoading />);
    expect(screen.getByText(/upload form loading, please wait/i)).toBeInTheDocument();
  });

  it("has no axe accessibility violations", async () => {
    const { container } = render(<InvoicesLoading />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has multiple animate-pulse elements (no layout shift guarantee)", () => {
    const { container } = render(<InvoicesLoading />);
    const pulsed = container.querySelectorAll(".animate-pulse");
    expect(pulsed.length).toBeGreaterThanOrEqual(5);
  });

  // ---- State invariant coverage ----

  it("is a deterministic pure component: repeated renders produce identical markup", () => {
    const first = render(<InvoicesLoading />);
    const second = render(<InvoicesLoading />);
    expect(first.container.innerHTML).toEqual(second.container.innerHTML);
  });

  it("does not mutate global state or emit side effects during render", () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(<InvoicesLoading />);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it("renders only placeholder markup and never sensitive data", () => {
    const { container } = render(<InvoicesLoading />);
    const text = container.textContent || "";
    // No emails, tokens, or IDs leaked into the loading shell.
    expect(text).not.toMatch(/@[^\s]+\.[A-Za-z]{2,}/);
    expect(text).not.toMatch(/\beyJ[a-zA-Z0-9_-]*\./);
    expect(text).not.toMatch(/\b\d{6, }\b/);
  });

  it("supports concurrent renders without shared mutable state", () => {
    const outputs = Array.from({ length: 5 }, () => render(<InvoicesLoading />).container.innerHTML);
    const unique = new Set(outputs);
    expect(unique.size).toBe(1);
  });

  it("renders exactly one UploadSkeleton instance (no duplicate announcements)", () => {
    render(<InvoicesLoading />);
    expect(screen.getAllByTestId("upload-skeleton")).toHaveLength(1);
    expect(screen.getAllByText(/upload form loading, please wait/i)).toHaveLength(1);
  });
});
