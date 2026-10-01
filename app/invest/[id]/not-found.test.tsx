/**
 * @file app/invest/[id]/not-found.test.tsx
 *
 * Focused tests for the invoice-detail not-found boundary.
 *
 * They pin the invariants documented in `not-found.js`:
 *   I1 route-state preservation (sanitized filters survive the 404)
 *   I2 no untrusted parameter reflection (allow-list only, no open redirect)
 *   I3 determinism / idempotence (pure function of the URL)
 *   I4 safe degradation when the query string is unavailable
 *   I5 no data disclosure / branding + a11y regressions
 *
 * `next/link` is mapped to a plain <a> by jest.config.js, and
 * `next/navigation` is mocked below so each case controls the query string.
 */

import "@testing-library/jest-dom";
import React from "react";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";

const mockUseSearchParams = jest.fn();

jest.mock("next/navigation", () => ({
  useSearchParams: () => mockUseSearchParams(),
}));

import InvoiceNotFound from "./not-found";

const MARKETPLACE_LINK = "invoice-not-found-marketplace-link";
const HOME_LINK = "invoice-not-found-home-link";

function renderBoundary(searchParams) {
  mockUseSearchParams.mockReturnValue(searchParams);
  return render(<InvoiceNotFound />);
}

function marketplaceHref() {
  return screen.getByTestId(MARKETPLACE_LINK).getAttribute("href");
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseSearchParams.mockReturnValue(new URLSearchParams());
});

// ── I1: route-state preservation ──────────────────────────────────────────────

describe("I1 — recovery preserves sanitized marketplace route state", () => {
  it("falls back to the unfiltered marketplace when there is no query string", () => {
    renderBoundary(new URLSearchParams());
    expect(marketplaceHref()).toBe("/invest");
  });

  it("carries supported filters, sort, and ranges into the recovery link", () => {
    renderBoundary(
      new URLSearchParams(
        "q=Acme&currency=EUR&yieldMin=8.2&yieldMax=9.5&maturityFrom=2026-01-01&maturityTo=2026-12-31&sort=yield&sortDir=desc&statuses=Open,Funded"
      )
    );

    expect(marketplaceHref()).toBe(
      "/invest?q=Acme&currency=EUR&yieldMin=8.2&yieldMax=9.5&maturityFrom=2026-01-01&maturityTo=2026-12-31&sort=yield&sortDir=desc&statuses=Open%2CFunded"
    );
  });

  it("is deterministic for duplicate keys (first value wins, repeated renders match)", () => {
    const params = new URLSearchParams("q=first&q=second&statuses=Open&statuses=Funded");

    const first = renderBoundary(params);
    const firstHref = marketplaceHref();
    const firstHtml = first.container.innerHTML;
    first.unmount();

    const second = renderBoundary(new URLSearchParams(params.toString()));
    expect(marketplaceHref()).toBe(firstHref);
    expect(second.container.innerHTML).toBe(firstHtml);
    expect(firstHref).toBe("/invest?q=first&statuses=Open");
  });
});

// ── I2: no untrusted parameter reflection ─────────────────────────────────────

describe("I2 — only allow-listed parameters reach the recovery link", () => {
  it("drops unknown keys and invalid values instead of reflecting them", () => {
    renderBoundary(
      new URLSearchParams(
        "redirect=https://evil.example&token=SUPER_SECRET&currency=CAD&sort=unknown&yieldMin=abc&yieldMax=9.5&maturityFrom=2026-13-40&statuses=Open,Unknown&q=Acme"
      )
    );

    const href = marketplaceHref();
    expect(href).toBe("/invest?q=Acme&yieldMax=9.5&statuses=Open");
    expect(href).not.toContain("evil.example");
    expect(href).not.toContain("SUPER_SECRET");
    expect(href).not.toContain("CAD");
    expect(href).not.toContain("Unknown");
  });

  it("cannot be turned into an open redirect: the href is always same-origin /invest", () => {
    renderBoundary(
      new URLSearchParams(
        "redirect=https://evil.example&next=//evil.example&url=javascript:alert(1)"
      )
    );

    expect(marketplaceHref()).toBe("/invest");
  });

  it("drops empty / whitespace-only boundary values", () => {
    renderBoundary(new URLSearchParams("q=%20%20&statuses=&currency=&yieldMin=&yieldMax="));
    expect(marketplaceHref()).toBe("/invest");
  });
});

// ── I3: determinism / idempotence ─────────────────────────────────────────────

describe("I3 — output is a pure function of the URL", () => {
  it("renders byte-identical markup for repeated renders of the same URL", () => {
    const params = new URLSearchParams("q=Acme&statuses=Open&sort=amount&sortDir=asc");

    const a = renderBoundary(new URLSearchParams(params.toString()));
    const aHtml = a.container.innerHTML;
    a.unmount();

    const b = renderBoundary(new URLSearchParams(params.toString()));
    expect(b.container.innerHTML).toBe(aHtml);
    b.unmount();

    const c = renderBoundary(new URLSearchParams(params.toString()));
    expect(c.container.innerHTML).toBe(aHtml);
  });

  it("is idempotent under the compound sort form", () => {
    renderBoundary(new URLSearchParams("sort=yield_desc"));
    expect(marketplaceHref()).toBe("/invest?sort=yield&sortDir=desc");
  });
});

// ── I4: safe degradation ──────────────────────────────────────────────────────

describe("I4 — absent query state degrades safely", () => {
  it("uses the unfiltered marketplace when useSearchParams returns null", () => {
    renderBoundary(null);
    expect(marketplaceHref()).toBe("/invest");
  });

  it("uses the unfiltered marketplace when useSearchParams returns undefined", () => {
    renderBoundary(undefined);
    expect(marketplaceHref()).toBe("/invest");
  });
});

// ── I5: no disclosure / branding + a11y regression ────────────────────────────

describe("I5 — no data disclosure and no UI regressions", () => {
  it("never echoes query values into visible copy", () => {
    renderBoundary(new URLSearchParams("token=SUPER_SECRET&q=Acme"));
    expect(screen.queryByText(/SUPER_SECRET/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Acme/)).not.toBeInTheDocument();
  });

  it("renders the original copy, a single h1, and the main landmark", () => {
    renderBoundary(new URLSearchParams());
    expect(
      screen.getByRole("heading", { level: 1, name: "Invoice not found" })
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("aria-labelledby", "invoice-not-found-heading");
  });

  it("keeps the home link fixed at / and the marketplace label stable", () => {
    renderBoundary(new URLSearchParams("q=Acme"));
    expect(screen.getByTestId(HOME_LINK)).toHaveAttribute("href", "/");
    expect(screen.getByTestId(MARKETPLACE_LINK)).toHaveTextContent("Browse marketplace");
  });

  it("has no axe violations", async () => {
    const { container } = renderBoundary(new URLSearchParams("q=Acme&statuses=Open"));
    expect(await axe(container)).toHaveNoViolations();
  });
});
