/**
 * @file app/invest/loading.test.jsx
 * Regression tests for the Next.js route-level loading UI at /invest.
 *
 * This component holds no mutable state — it is a static skeleton — so the
 * invariants worth locking are the loading *contract*:
 *  - it renders without errors
 *  - it declares aria-busy="true" so assistive tech knows content is pending
 *  - it delegates to the shared NavMenuSkeleton / InvoiceListSkeleton
 *    components rather than duplicating their markup
 *  - it passes the documented row count through to InvoiceListSkeleton
 *  - its output is deterministic, so server and client renders agree
 *  - it exposes no interactive or focusable controls while loading
 *  - it has no accessibility violations
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import InvestLoading from "./loading";

expect.extend(toHaveNoViolations);

describe("InvestLoading", () => {
  it("renders without crashing", () => {
    expect(() => render(<InvestLoading />)).not.toThrow();
  });

  it("renders the page root with aria-busy='true'", () => {
    render(<InvestLoading />);
    expect(screen.getByTestId("invest-loading")).toHaveAttribute("aria-busy", "true");
  });

  it("delegates to the shared NavMenuSkeleton component", () => {
    // NavMenuSkeleton carries no test id, so assert on its structural
    // signature: a sticky <header aria-busy="true"> whose contents are
    // aria-hidden, since the real NavMenu replaces it on settle.
    const { container } = render(<InvestLoading />);
    const header = container.querySelector("header");
    expect(header).toBeInTheDocument();
    expect(header).toHaveAttribute("aria-busy", "true");
    expect(header).toHaveAttribute("aria-hidden", "true");
  });

  it("delegates to InvoiceListSkeleton and passes the documented row count", () => {
    render(<InvestLoading />);

    // InvoiceListSkeleton labels its list for the invest flow.
    const list = screen.getByRole("list", { name: /loading investable invoices/i });
    expect(list).toBeInTheDocument();
    expect(list).toHaveAttribute("aria-busy", "true");

    // loading.js passes rows={3}; assert the count actually rendered so a
    // silent prop regression cannot shorten the skeleton unnoticed.
    expect(list.querySelectorAll("li")).toHaveLength(3);
  });

  it("renders the four filter/action placeholders", () => {
    const { container } = render(<InvestLoading />);
    const filterRow = container.querySelector(".mb-8.rounded-xl");
    expect(filterRow).not.toBeNull();
    expect(filterRow.querySelectorAll(".animate-pulse")).toHaveLength(4);
  });

  it("renders the title and subtitle skeleton lines", () => {
    const { container } = render(<InvestLoading />);
    expect(container.querySelector(".h-7.w-24")).toBeInTheDocument();
    // Two subtitle lines under the title.
    expect(container.querySelectorAll(".h-4")).toHaveLength(2);
  });

  it("renders deterministically — two renders produce identical markup", () => {
    // A loading skeleton must never introduce non-determinism (Math.random,
    // Date.now, locale formatting): differing server/client markup is a
    // hydration mismatch, and random keys are unstable.
    const first = render(<InvestLoading />).container.innerHTML;
    const second = render(<InvestLoading />).container.innerHTML;
    expect(second).toBe(first);
  });

  it("exposes no interactive or focusable controls while loading", () => {
    const { container } = render(<InvestLoading />);

    // A pending route must not offer actions the user could fire against
    // data that has not arrived, nor trap focus mid-navigation.
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelectorAll("input, select, textarea")).toHaveLength(0);
    expect(container.querySelectorAll('[tabindex]:not([tabindex="-1"])')).toHaveLength(0);
  });

  it("has no axe accessibility violations", async () => {
    const { container } = render(<InvestLoading />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it("has enough animate-pulse elements to avoid a layout shift", () => {
    const { container } = render(<InvestLoading />);
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThanOrEqual(5);
  });
});
