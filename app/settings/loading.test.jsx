/**
 * @jest-environment jsdom
 */

/* eslint-env jest */

/**
 * @file app/settings/loading.test.jsx
 * Comprehensive unit, boundary, integration, and accessibility tests for SettingsLoading
 * with deterministic failure recovery.
 */

// @ts-nocheck

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import SettingsLoading, {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  SettingsLoadingErrorBoundary,
} from "./loading";
import { reportError } from "../../lib/observability/reportError";

expect.extend(toHaveNoViolations);

/* global describe, it, expect, jest */

describe("SettingsLoading", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    throwChildError = true;
  });

  it("renders the page root with data-testid='settings-loading'", () => {
    render(<SettingsLoading />);
    expect(screen.getByTestId("settings-loading")).toBeInDocument();
  });

  describe("Deterministic Timeout Failure Recovery", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("transitions deterministically to TIMED_OUT after DEFAULT_TIMEOUT_MS", () => {
      const onError = jest.fn();
      render(<SettingsLoading onError={onError} />);

      expect(screen.getByTestId("settings-loading")).toHaveAttribute("aria-busy", "true");
      expect(screen.queryByTestId("settings-loading-fallback")).not.toBeInTheDocument();

      // Advance by slightly less than the timeout
      act(() => {
        jest.advanceTimersByTime(DEFAULT_TIMEOUT_MS - 100);
      });
      expect(screen.queryByTestId("settings-loading-fallback")).not.toBeInTheDocument();

      // Trigger timeout transition
      act(() => {
        jest.advanceTimersByTime(100);
      });

      expect(screen.getByTestId("settings-loading")).toHaveAttribute("aria-busy", "false");
      expect(screen.getByTestId("settings-loading")).toHaveAttribute("data-status", "timed_out");
      expect(screen.getByTestId("settings-loading-fallback")).toBeInTheDocument();
      expect(screen.getByText("Loading timed out")).toBeInTheDocument();
      expect(
        screen.getByText(/settings are taking longer than expected to load/i)
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();

      // Observability checks
      expect(reportError).toHaveBeenCalledTimes(1);
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "SettingsLoadingTimeoutError",
          code: "LOADING_TIMEOUT",
        }),
        expect.objectContaining({
          boundary: "SettingsLoading",
          phase: "timeout",
          retryCount: 0,
        })
      );

      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ phase: "timeout", retryCount: 0 })
      );
    });

    it("respects custom timeoutMs threshold", () => {
      render(<SettingsLoading timeoutMs={500} />);

      act(() => {
        jest.advanceTimersByTime(499);
      });
      expect(screen.queryByTestId("settings-loading-fallback")).not.toBeInTheDocument();

      act(() => {
        jest.advanceTimersByTime(1);
      });
      expect(screen.getByTestId("settings-loading-fallback")).toBeInTheDocument();
    });

    it("clears timeout timer cleanly on component unmount", () => {
      const onError = jest.fn();
      const { unmount } = render(<SettingsLoading timeoutMs={1000} onError={onError} />);

      unmount();

      act(() => {
        jest.advanceTimersByTime(2000);
      });

      expect(reportError).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });

    describe("Boundary cases for timeoutMs", () => {
      it("disables timeout when timeoutMs is 0", () => {
        render(<SettingsLoading timeoutMs={0} />);
        act(() => {
          jest.advanceTimersByTime(30000);
        });
        expect(screen.queryByTestId("settings-loading-fallback")).not.toBeInTheDocument();
        expect(screen.getByTestId("settings-loading")).toHaveAttribute("aria-busy", "true");
      });

      it("disables timeout when timeoutMs is negative", () => {
        render(<SettingsLoading timeoutMs={-500} />);
        act(() => {
          jest.advanceTimersByTime(30000);
        });
        expect(screen.queryByTestId("settings-loading-fallback")).not.toBeInTheDocument();
      });

      it("disables timeout when timeoutMs is null", () => {
        render(<SettingsLoading timeoutMs={null} />);
        act(() => {
          jest.advanceTimersByTime(30000);
        });
        expect(screen.queryByTestId("settings-loading-fallback")).not.toBeInTheDocument();
      });

      it("disables timeout when timeoutMs is NaN", () => {
        render(<SettingsLoading timeoutMs={NaN} />);
        act(() => {
          jest.advanceTimersByTime(30000);
        });
        expect(screen.queryByTestId("settings-loading-fallback")).not.toBeInTheDocument();
      });
    });
  });

  it("renders the NavMenuSkeleton header", () => {
    const { container } = render(<SettingsLoading />);
    const header = container.querySelector("header");
    expect(header).toBeInDocument();
  });

  it("renders the ThemeSkeleton component (data-testid='theme-skeleton')", () => {
    render(<SettingsLoading />);
    expect(screen.getByTestId("theme-skeleton")).toBeInDocument();
  });

  describe("Accessibility Across All States (jest-axe)", () => {
    it("has no accessibility violations in TIMED_OUT state", async () => {
      jest.useFakeTimers();
      const { container } = render(<SettingsLoading timeoutMs={100} />);
      act(() => {
        jest.advanceTimersByTime(100);
      });
      jest.useRealTimers();

      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("has no accessibility violations in ERROR state", async () => {
      const { container } = render(
        <SettingsLoading initialError={new Error("Accessibility check error")} />
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });

    it("has no accessibility violations in EXHAUSTED state", async () => {
      jest.useFakeTimers();
      const { container } = render(<SettingsLoading timeoutMs={100} maxRetries={0} />);
      act(() => {
        jest.advanceTimersByTime(100);
      });
      jest.useRealTimers();

      expect(screen.getByTestId("settings-loading")).toHaveAttribute("data-status", "exhausted");
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  it("contains the sr-only loading announcement from ThemeSkeleton", () => {
    render(<SettingsLoading />);
    expect(screen.getByText(/theme settings loading, please wait/i)).toBeInDocument();
  });

  describe("Compatibility Contracts & Edge Cases", () => {
    it("safely handles nullish and primitive inputs to component function", () => {
      expect(() => render(SettingsLoading(null))).not.toThrow();
      expect(() => render(SettingsLoading(undefined))).not.toThrow();
      expect(() => render(SettingsLoading(42))).not.toThrow();
      expect(() => render(SettingsLoading("invalid-string"))).not.toThrow();
      expect(() => render(SettingsLoading([]))).not.toThrow();
    });

    it("merges custom className without displacing base layout classes", () => {
      render(<SettingsLoading className="custom-wrapper-class extra-padding" />);
      const root = screen.getByTestId("settings-loading");
      expect(root).toHaveClass(
        "min-h-screen",
        "bg-slate-950",
        "custom-wrapper-class",
        "extra-padding"
      );
    });

    it("allows overriding isBusy to false while preserving ARIA semantics", () => {
      render(<SettingsLoading isBusy={false} />);
      const root = screen.getByTestId("settings-loading");
      expect(root).toHaveAttribute("aria-busy", "false");
      expect(screen.getByTestId("theme-skeleton")).toHaveAttribute("aria-busy", "false");
    });

    it("allows custom data-testid while falling back to default", () => {
      render(<SettingsLoading data-testid="custom-settings-loader" />);
      expect(screen.getByTestId("custom-settings-loader")).toBeInTheDocument();
    });

    it("forwards arbitrary HTML and data attributes safely to root", () => {
      render(
        <SettingsLoading
          id="route-settings-loading"
          data-env="production"
          title="Loading settings"
        />
      );
      const root = screen.getByTestId("settings-loading");
      expect(root).toHaveAttribute("id", "route-settings-loading");
      expect(root).toHaveAttribute("data-env", "production");
      expect(root).toHaveAttribute("title", "Loading settings");
    });

    it("renders optional children slot without displacing default skeleton", () => {
      render(
        <SettingsLoading>
          <div data-testid="settings-custom-addon">Extra status info</div>
        </SettingsLoading>
      );
      expect(screen.getByTestId("settings-loading")).toBeInTheDocument();
      expect(screen.getByTestId("theme-skeleton")).toBeInTheDocument();
      expect(screen.getByTestId("settings-custom-addon")).toHaveTextContent("Extra status info");
    });

    it("preserves accessibility when rendered with custom props and children", async () => {
      const { container } = render(
        <SettingsLoading className="custom-test" isBusy={true}>
          <div className="text-slate-400 text-sm mt-4">Loading user profile preferences...</div>
        </SettingsLoading>
      );
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
  });

  /**
   * Concurrency / idempotency regression guards.
   *
   * The /settings loading UI is a pure, side-effect-free component so that concurrent or
   * repeated renders (e.g. React StrictMode double-invoke, Suspense retries, route
   * prefetch + navigation races) cannot produce stale or inconsistent output.
   */
  describe("concurrency and idempotency", () => {
    it("renders identical markup across repeated renders", () => {
      const first = render(<SettingsLoading />);
      const firstHtml = first.container.innerHTML;
      first.unmount();

      const second = render(<SettingsLoading />);
      const secondHtml = second.container.innerHTML;
      second.unmount();

      expect(secondHtml).toEqual(firstHtml);
    });

    it("supports concurrent instances without duplicate testid leaks", () => {
      const a = render(<SettingsLoading />);
      const b = render(<SettingsLoading />);

      // Each instance must own exactly one root and one ThemeSkeleton.
      expect(a.getByTestId("settings-loading")).toBeInDocument();
      expect(b.getByTestId("settings-loading")).toBeInDocument();
      expect(a.getByTestId("theme-skeleton")).toBeInDocument();
      expect(b.getByTestId("theme-skeleton")).toBeInDocument();

      a.unmount();
      b.unmount();
    });

    it("remains stable when unmounted and remounted rapidly", () => {
      const { unmount } = render(<SettingsLoading />);
      expect(() => unmount()).not.toThrow();

      const remounted = render(<SettingsLoading />);
      expect(remounted.getByTestId("settings-loading")).toHaveAttribute("aria-busy", "true");
      remounted.unmount();
    });

    it("produces no console errors or warnings during render", () => {
      const spyError = jest.spyOn(console, "error").mockImplementation(() => {});
      const spyWarn = jest.spyOn(console, "warn").mockImplementation(() => {});

      const { unmount } = render(<SettingsLoading />);
      unmount();

      expect(spyError).not.toHaveBeenCalled();
      expect(spyWarn).not.toHaveBeenCalled();

      spyError.mockRestore();
      spyWarn.mockRestore();
    });
  });
});
