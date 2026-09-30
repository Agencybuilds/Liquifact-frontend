/**
 * @file app/settings/loading.test.jsx
 * Comprehensive unit, boundary, integration, and accessibility tests for SettingsLoading
 * with deterministic failure recovery.
 */

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

jest.mock("../../lib/observability/reportError", () => ({
  reportError: jest.fn(),
}));

let throwChildError = true;

function FaultyChild() {
  if (throwChildError) {
    throw new Error("Simulated render crash in settings child");
  }
  return <div data-testid="recovered-child">Recovered content</div>;
}

describe("SettingsLoading", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    throwChildError = true;
  });

  describe("Default Render & Structural Backward Compatibility", () => {
    it("renders without crashing", () => {
      expect(() => render(<SettingsLoading />)).not.toThrow();
    });

    it("renders the page root with data-testid='settings-loading'", () => {
      render(<SettingsLoading />);
      expect(screen.getByTestId("settings-loading")).toBeInTheDocument();
    });

    it("renders the page root with aria-busy='true'", () => {
      render(<SettingsLoading />);
      expect(screen.getByTestId("settings-loading")).toHaveAttribute("aria-busy", "true");
    });

    it("renders the page root with data-status='loading'", () => {
      render(<SettingsLoading />);
      expect(screen.getByTestId("settings-loading")).toHaveAttribute("data-status", "loading");
    });

    it("renders the NavMenuSkeleton header", () => {
      const { container } = render(<SettingsLoading />);
      const header = container.querySelector("header");
      expect(header).toBeInTheDocument();
    });

    it("renders the ThemeSkeleton component (data-testid='theme-skeleton')", () => {
      render(<SettingsLoading />);
      expect(screen.getByTestId("theme-skeleton")).toBeInTheDocument();
    });

    it("ThemeSkeleton inside SettingsLoading has aria-busy='true'", () => {
      render(<SettingsLoading />);
      expect(screen.getByTestId("theme-skeleton")).toHaveAttribute("aria-busy", "true");
    });

    it("contains the sr-only loading announcement from ThemeSkeleton", () => {
      render(<SettingsLoading />);
      expect(screen.getByText(/theme settings loading, please wait/i)).toBeInTheDocument();
    });

    it("has multiple animate-pulse elements", () => {
      const { container } = render(<SettingsLoading />);
      const pulsed = container.querySelectorAll(".animate-pulse");
      expect(pulsed.length).toBeGreaterThanOrEqual(5);
    });

    it("renders custom children placeholder when supplied", () => {
      render(
        <SettingsLoading>
          <div data-testid="custom-placeholder">Custom Loading...</div>
        </SettingsLoading>
      );
      expect(screen.getByTestId("custom-placeholder")).toBeInTheDocument();
    });

    it("has no axe accessibility violations on initial load", async () => {
      const { container } = render(<SettingsLoading />);
      const results = await axe(container);
      expect(results).toHaveNoViolations();
    });
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

  describe("Subtree Render Error Catching & Recovery", () => {
    it("catches child render error and transitions deterministically to ERROR state", () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      const onError = jest.fn();

      render(
        <SettingsLoading onError={onError}>
          <FaultyChild />
        </SettingsLoading>
      );

      expect(screen.getByTestId("settings-loading")).toHaveAttribute("aria-busy", "false");
      expect(screen.getByTestId("settings-loading")).toHaveAttribute("data-status", "error");
      expect(screen.getByTestId("settings-loading-fallback")).toBeInTheDocument();
      expect(screen.getByText("Unable to load settings")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();

      // Observability checks
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Simulated render crash in settings child" }),
        expect.objectContaining({
          boundary: "SettingsLoading",
          phase: "render_error",
          retryCount: 0,
        })
      );

      expect(onError).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({ phase: "render_error", retryCount: 0 })
      );

      consoleErrorSpy.mockRestore();
    });

    it("supports direct initialError property without crashing", () => {
      const preError = new Error("Pre-existing bootstrap failure");
      render(<SettingsLoading initialError={preError} />);

      expect(screen.getByTestId("settings-loading")).toHaveAttribute("data-status", "error");
      expect(screen.getByTestId("settings-loading-fallback")).toBeInTheDocument();
      expect(screen.getByText("Unable to load settings")).toBeInTheDocument();
    });
  });

  describe("Deterministic Retry & Idempotent Concurrency Handling", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it("recovers from timeout on retry click and restarts loading cycle", () => {
      const onRetry = jest.fn();
      render(<SettingsLoading timeoutMs={1000} onRetry={onRetry} />);

      // Trigger timeout
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(screen.getByTestId("settings-loading")).toHaveAttribute("data-status", "timed_out");

      // Click "Try again"
      const retryButton = screen.getByRole("button", { name: "Try again" });
      fireEvent.click(retryButton);

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith({ attempt: 1, maxRetries: DEFAULT_MAX_RETRIES });

      // Transitions back to LOADING
      expect(screen.getByTestId("settings-loading")).toHaveAttribute("data-status", "loading");
      expect(screen.getByTestId("settings-loading")).toHaveAttribute("aria-busy", "true");
      expect(screen.queryByTestId("settings-loading-fallback")).not.toBeInTheDocument();
      expect(screen.getByTestId("theme-skeleton")).toBeInTheDocument();

      // A second timeout can occur if the retry also takes longer than threshold
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(screen.getByTestId("settings-loading")).toHaveAttribute("data-status", "timed_out");
      // Shows attempt details on subsequent failures
      expect(screen.getByText(/attempt 1 of 3/i)).toBeInTheDocument();
    });

    it("recovers from child error when child is fixed on retry", () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

      render(
        <SettingsLoading
          onRetry={() => {
            throwChildError = false;
          }}
        >
          <FaultyChild />
        </SettingsLoading>
      );

      expect(screen.getByTestId("settings-loading")).toHaveAttribute("data-status", "error");

      // Click retry
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));

      expect(screen.getByTestId("settings-loading")).toHaveAttribute("data-status", "loading");
      expect(screen.getByTestId("recovered-child")).toBeInTheDocument();

      consoleErrorSpy.mockRestore();
    });

    it("enforces idempotency and prevents concurrent retry triggers while retrying", async () => {
      let resolvePromise;
      const deferredPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      const onRetry = jest.fn().mockReturnValue(deferredPromise);
      render(<SettingsLoading timeoutMs={500} onRetry={onRetry} />);

      act(() => {
        jest.advanceTimersByTime(500);
      });

      const retryButton = screen.getByRole("button", { name: "Try again" });

      // Click retry 3 times rapidly
      fireEvent.click(retryButton);
      fireEvent.click(retryButton);
      fireEvent.click(retryButton);

      // onRetry should only have been called once
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("settings-loading")).toHaveAttribute("data-status", "retrying");

      // Resolve the async retry
      await act(async () => {
        resolvePromise();
      });

      expect(screen.getByTestId("settings-loading")).toHaveAttribute("data-status", "loading");
    });

    it("handles async onRetry rejection safely", async () => {
      let rejectPromise;
      const deferredPromise = new Promise((_, reject) => {
        rejectPromise = reject;
      });

      const onRetry = jest.fn().mockReturnValue(deferredPromise);
      render(<SettingsLoading timeoutMs={500} onRetry={onRetry} />);

      act(() => {
        jest.advanceTimersByTime(500);
      });

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(screen.getByTestId("settings-loading")).toHaveAttribute("data-status", "retrying");

      // Reject the retry promise
      await act(async () => {
        rejectPromise(new Error("Network connection refused"));
      });

      expect(screen.getByTestId("settings-loading")).toHaveAttribute("data-status", "error");
      expect(reportError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Network connection refused" }),
        expect.objectContaining({ phase: "retry_failure", retryCount: 1 })
      );
    });

    it("enters EXHAUSTED state after maxRetries is reached", () => {
      render(<SettingsLoading timeoutMs={500} maxRetries={2} />);

      // Initial failure (timeout 0)
      act(() => {
        jest.advanceTimersByTime(500);
      });
      expect(screen.getByTestId("settings-loading")).toHaveAttribute("data-status", "timed_out");
      expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();

      // Retry 1: attempt 1
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      act(() => {
        jest.advanceTimersByTime(500);
      });
      expect(screen.getByText(/attempt 1 of 2/i)).toBeInTheDocument();

      // Retry 2: attempt 2 (reaches safeMaxRetries)
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      act(() => {
        jest.advanceTimersByTime(500);
      });

      // Now exhausted
      expect(screen.getByTestId("settings-loading")).toHaveAttribute("data-status", "exhausted");
      expect(screen.getByText("Loading failed")).toBeInTheDocument();
      expect(
        screen.getByText(/settings could not be loaded after multiple attempts/i)
      ).toBeInTheDocument();
      // Action button must be hidden to prevent infinite loops
      expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    });

    it("handles non-function onRetry gracefully without crashing", () => {
      render(<SettingsLoading timeoutMs={500} onRetry="invalid-non-function" />);
      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(() => {
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      }).not.toThrow();

      expect(screen.getByTestId("settings-loading")).toHaveAttribute("data-status", "loading");
    });
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

  describe("SettingsLoadingErrorBoundary Isolated Unit Tests", () => {
    it("renders fallback UI when child throws", () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      const fallback = ({ error }) => <div>Custom fallback: {error.message}</div>;

      render(
        <SettingsLoadingErrorBoundary fallback={fallback}>
          <FaultyChild />
        </SettingsLoadingErrorBoundary>
      );

      expect(
        screen.getByText("Custom fallback: Simulated render crash in settings child")
      ).toBeInTheDocument();
      consoleErrorSpy.mockRestore();
    });

    it("resets error state when reset is called", () => {
      const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
      let triggerReset;

      render(
        <SettingsLoadingErrorBoundary
          fallback={({ reset }) => {
            triggerReset = reset;
            return <button onClick={reset}>Reset boundary</button>;
          }}
        >
          <FaultyChild />
        </SettingsLoadingErrorBoundary>
      );

      expect(screen.getByRole("button", { name: "Reset boundary" })).toBeInTheDocument();

      throwChildError = false;
      act(() => {
        triggerReset();
      });

      expect(screen.getByText("Recovered content")).toBeInTheDocument();
      consoleErrorSpy.mockRestore();
    });
  });
});
