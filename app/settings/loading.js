/**
 * @file app/settings/loading.js
 * Next.js route-level loading UI for the /settings page.
 *
 * Rendered automatically by the Next.js App Router while the page segment
 * is streaming. Delegates the content area to the reusable ThemeSkeleton
 * component so both stay in sync with the real settings layout.
 *
 * Preserves compatibility contracts:
 *  - Both default export and named export `SettingsLoading` are exposed.
 *  - Handles null, undefined, primitive, and empty prop boundaries gracefully.
 *  - Supports custom `className` forwarding with base theme styles preserved.
 *  - Enforces accessible loading semantics (`role="status"`, `aria-live="polite"`, `aria-busy`).
 *  - Retains predictable `data-testid="settings-loading"` by default while allowing caller overrides.
 *  - Forwards standard HTML attributes and optional child augmentations safely.
 *
 * @see components/ThemeSkeleton.jsx — reusable theme/settings skeleton
 * @see components/NavMenuSkeleton.jsx — reusable top navigation skeleton
 */
import NavMenuSkeleton from "../../components/NavMenuSkeleton";
import ThemeSkeleton from "../../components/ThemeSkeleton";

export const SETTINGS_LOADING_BASE_CLASS = "min-h-screen bg-slate-950 text-slate-50";
export const SETTINGS_LOADING_TEST_ID = "settings-loading";

/**
 * SettingsLoading — Next.js route-level loading shell for /settings.
 *
 * @param {object} [props]
 * @param {string} [props.className] - Optional extra CSS class names for the root container.
 * @param {boolean} [props.isBusy=true] - Whether the region is currently in a busy/loading state.
 * @param {string} [props["data-testid"]] - Test ID override, defaults to "settings-loading".
 * @param {React.ReactNode} [props.children] - Optional slot for auxiliary loading elements.
 * @returns {JSX.Element}
 */
export function SettingsLoading(props) {
  // Defensive prop normalization against invalid, nullish, or primitive inputs
  const safeProps = props && typeof props === "object" && !Array.isArray(props) ? props : {};
  const {
    className = "",
    isBusy = true,
    "data-testid": testId = SETTINGS_LOADING_TEST_ID,
    role = "status",
    "aria-live": ariaLive = "polite",
    children,
    ...rest
  } = safeProps;

  const busyValue = isBusy ? "true" : "false";
  const mergedClassName = [SETTINGS_LOADING_BASE_CLASS, className].filter(Boolean).join(" ");

  return (
    <div
      className={mergedClassName}
      aria-busy={busyValue}
      role={role}
      aria-live={ariaLive}
      data-testid={testId}
      {...rest}
    >
      {/* ---- Reusable nav skeleton ---- */}
      <NavMenuSkeleton />

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        {/* ---- Reusable theme/settings skeleton ---- */}
        <ThemeSkeleton isBusy={isBusy} />
        {children}
      </main>
    </div>
  );
}

export default SettingsLoading;
