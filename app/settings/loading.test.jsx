/**
 * @file app/settings/loading.test.jsx
 * Tests for the Next.js route-level loading UI at /settings.
 *
 * Verifies that SettingsLoading:
 *  - renders without errors across default and edge-case inputs
 *  - delegates to ThemeSkeleton and NavMenuSkeleton
 *  - exposes the correct ARIA attributes and role semantics on the page shell
 *  - preserves compatibility contracts (named + default export, custom props, class merging)
 *  - handles adverse inputs gracefully (null, undefined, primitives)
 *  - has no accessibility violations (axe-core)
 */

import React from "react";
import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import SettingsLoadingDefault, {
  SettingsLoading,
  SETTINGS_LOADING_BASE_CLASS,
  SETTINGS_LOADING_TEST_ID,
} from "./loading";

expect.extend(toHaveNoViolations);

describe("SettingsLoading", () => {
  it("renders without crashing with default props", () => {
    expect(() => render(<SettingsLoading />)).not.toThrow();
  });

  it("exports identical default and named component references", () => {
    expect(SettingsLoadingDefault).toBe(SettingsLoading);
    expect(typeof SettingsLoading).toBe("function");
  });

  it("exposes public contract constants", () => {
    expect(SETTINGS_LOADING_TEST_ID).toBe("settings-loading");
    expect(SETTINGS_LOADING_BASE_CLASS).toContain("min-h-screen");
    expect(SETTINGS_LOADING_BASE_CLASS).toContain("bg-slate-950");
  });

  it("renders the page root with data-testid='settings-loading' and base classes", () => {
    render(<SettingsLoading />);
    const root = screen.getByTestId("settings-loading");
    expect(root).toBeInTheDocument();
    expect(root).toHaveClass("min-h-screen", "bg-slate-950", "text-slate-50");
  });

  it("renders the page root with aria-busy='true', role='status', and aria-live='polite'", () => {
    render(<SettingsLoading />);
    const root = screen.getByTestId("settings-loading");
    expect(root).toHaveAttribute("aria-busy", "true");
    expect(root).toHaveAttribute("role", "status");
    expect(root).toHaveAttribute("aria-live", "polite");
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

  it("has no axe accessibility violations", async () => {
    const { container } = render(<SettingsLoading />);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
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
});
