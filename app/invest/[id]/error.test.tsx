/**
 * Tests for app/invest/[id]/error.js — the segment-level error boundary.
 *
 * Focus: the determinism invariants the boundary exists to enforce.
 *  - exactly-once reporting per distinct error instance
 *  - single-flight recovery (re-entrant clicks are ignored)
 *  - recovery failures are caught and surfaced deterministically
 *  - the marketplace escape hatch is always present
 *  - missing/non-string route ids never break rendering
 */
import React from "react";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";

expect.extend(toHaveNoViolations);

jest.mock("@/lib/observability/reportError", () => ({
  reportError: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useParams: jest.fn(),
}));

import { useParams } from "next/navigation";
import InvoiceDetailError, { INVEST_DETAIL_RECOVERY_FAILED } from "./error";
import { reportError } from "@/lib/observability/reportError";
import { copy } from "@/app/copy/en";

function makeError(message = "segment boom", digest = undefined) {
  const err = new Error(message);
  if (digest !== undefined) {
    err.digest = digest;
  }
  return err;
}

function renderBoundary({ error = makeError(), reset = jest.fn() } = {}) {
  return render(<InvoiceDetailError error={error} reset={reset} />);
}

describe("InvoiceDetailError (app/invest/[id]/error.js)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useParams.mockReturnValue({ id: "inv-001" });
  });

  describe("rendering", () => {
    it("renders the segment error container", () => {
      renderBoundary();
      expect(screen.getByTestId("invest-detail-error")).toBeInTheDocument();
    });

    it("renders an alert-role error banner with branded copy", () => {
      renderBoundary();
      expect(screen.getByRole("alert")).toBeInTheDocument();
      // title appears in the sr-only h1 and the banner heading
      expect(screen.getAllByText(copy.error.title).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(copy.error.description)).toBeInTheDocument();
    });

    it("renders the visually-hidden heading for screen readers", () => {
      renderBoundary();
      const h1 = document.querySelector("h1.sr-only");
      expect(h1).toBeInTheDocument();
      expect(h1).toHaveTextContent(copy.error.title);
    });

    it("always offers a route back to the marketplace", () => {
      renderBoundary();
      expect(screen.getByTestId("invest-detail-error-back")).toHaveAttribute("href", "/invest");
    });
  });

  describe("exactly-once reporting", () => {
    it("reports the error once on mount with non-sensitive route context", () => {
      const error = makeError("boom", "digest-1");
      renderBoundary({ error });
      expect(reportError).toHaveBeenCalledTimes(1);
      expect(reportError).toHaveBeenCalledWith(error, {
        digest: "digest-1",
        boundary: "invest-detail",
        routeId: "inv-001",
      });
    });

    it("does not re-report the same error instance on re-render", () => {
      const error = makeError("boom");
      const reset = jest.fn();
      const { rerender } = render(<InvoiceDetailError error={error} reset={reset} />);
      rerender(<InvoiceDetailError error={error} reset={reset} />);
      rerender(<InvoiceDetailError error={error} reset={reset} />);
      expect(reportError).toHaveBeenCalledTimes(1);
    });

    it("reports a new error instance (repeat failures are not suppressed)", () => {
      const reset = jest.fn();
      const { rerender } = render(<InvoiceDetailError error={makeError("first")} reset={reset} />);
      rerender(<InvoiceDetailError error={makeError("second")} reset={reset} />);
      expect(reportError).toHaveBeenCalledTimes(2);
    });

    it("does not report when no error is provided", () => {
      render(<InvoiceDetailError error={null} reset={jest.fn()} />);
      expect(reportError).not.toHaveBeenCalled();
    });
  });

  describe("deterministic recovery", () => {
    it("invokes reset when the action button is clicked", () => {
      const reset = jest.fn();
      renderBoundary({ reset });
      fireEvent.click(screen.getByRole("button"));
      expect(reset).toHaveBeenCalledTimes(1);
    });

    it("ignores a re-entrant click while recovery is in flight (single-flight)", () => {
      const reset = jest.fn(() => {
        // A reset that synchronously forces another click must not queue a
        // second recovery attempt.
        fireEvent.click(screen.getByRole("button"));
      });
      renderBoundary({ reset });

      fireEvent.click(screen.getByRole("button"));

      expect(reset).toHaveBeenCalledTimes(1);
    });

    it("catches a throwing reset, reports it, and shows the fallback", () => {
      const reset = jest.fn(() => {
        throw new Error("reset exploded");
      });
      renderBoundary({ reset });
      jest.clearAllMocks();

      expect(() => fireEvent.click(screen.getByRole("button"))).not.toThrow();

      expect(screen.getByText(INVEST_DETAIL_RECOVERY_FAILED)).toBeInTheDocument();
      expect(reportError).toHaveBeenCalledTimes(1);
      expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
        digest: undefined,
        boundary: "invest-detail-recovery",
        routeId: "inv-001",
      });
    });

    it("handles a missing reset handler without crashing", () => {
      render(<InvoiceDetailError error={makeError()} reset={undefined} />);

      expect(() => fireEvent.click(screen.getByRole("button"))).not.toThrow();

      expect(screen.getByText(INVEST_DETAIL_RECOVERY_FAILED)).toBeInTheDocument();
      expect(reportError).toHaveBeenCalledWith(expect.any(TypeError), {
        digest: undefined,
        boundary: "invest-detail-recovery",
        routeId: "inv-001",
      });
    });

    it("does not call reportError again when reset succeeds", () => {
      renderBoundary({ reset: jest.fn() });
      jest.clearAllMocks();
      fireEvent.click(screen.getByRole("button"));
      expect(reportError).not.toHaveBeenCalled();
    });
  });

  describe("route context", () => {
    it("still renders when the route id is missing", () => {
      useParams.mockReturnValue({});
      renderBoundary();
      expect(screen.getByTestId("invest-detail-error")).toBeInTheDocument();
      expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
        digest: undefined,
        boundary: "invest-detail",
        routeId: undefined,
      });
    });

    it("ignores a non-string route id", () => {
      useParams.mockReturnValue({ id: 42 });
      renderBoundary();
      expect(reportError).toHaveBeenCalledWith(expect.any(Error), {
        digest: undefined,
        boundary: "invest-detail",
        routeId: undefined,
      });
    });
  });

  describe("accessibility", () => {
    it("has no axe violations", async () => {
      const { container } = renderBoundary();
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });
});
