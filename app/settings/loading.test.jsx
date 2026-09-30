/**
 * @jest-environment jsdom
 */

/* eslint-env jest */

/**
 * @file app/settings/loading.test.jsx
 * Tests for the Next.js route-level loading UI at /settings.
 *
 * Verifies that SettingsLoading:
 *  - renders without errors
 *  - delegates to ThemeSkeleton
 *  - exposes the correct ARIA attributes on the page shell
 *  - has no accessibility violations
 */

// @ts-nocheck

import React from "react";
import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import SettingsLoading from "./loading";

expect.extend(toHaveNoViolations);

/* global describe, it, expect, jest */

describe("SettingsLoading", () => {
  it("renders without crashing", () => {
    expect(() => render(<SettingsLoading />)).not.toThrow();
  });

  it("renders the page root with data-testid='settings-loading'", () => {
    render(<SettingsLoading />);
    expect(screen.getByTestId("settings-loading")).toBeInDocument();
  });

  it("renders the page root with aria-busy='true'", () => {
    render(<SettingsLoading />);
    expect(screen.getByTestId("settings-loading")).toHaveAttribute("aria-busy", "true");
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

  it("ThemeSkeleton inside SettingsLoading has aria-busy='true'", () => {
    render(<SettingsLoading />);
    expect(screen.getByTestId("theme-skeleton")).toHaveAttribute("aria-busy", "true");
  });

  it("contains the sr-only loading announcement from ThemeSkeleton", () => {
    render(<SettingsLoading />);
    expect(screen.getByText(/theme settings loading, please wait/i)).toBeInDocument();
  });

  it("has multiple animate-pulse elements", () => {
    const { container } = render(<SettingsLoading />);
    const pulsed = container.querySelectorAll(".animate-pulse");
    expect(pulsed.length).toBeGreaterThanOrEqual(5);
  });

  it("has no axe accessibility violations", async () => {
    const { container } = render(<SettingsLoading />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
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
