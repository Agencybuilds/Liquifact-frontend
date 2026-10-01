/**
 * @file app/settings/lib.js
 *
 * Mock settings data and PX-safe helpers for the /settings page.
 *
 * ⚠️  SINGLE SOURCE OF TRUTH: This file is the only place mock settings
 * fixtures are defined. All components and tests must import
 * `MOCK_SETTINGS` and `loadMockSettings` from here.  Do NOT redeclare
 * them inline elsewhere.  Swap `loadMockSettings` for the real API
 * client once the backend `/settings` endpoint is wired.
 *
 * Contract per item: { id, category, label, type, value, description }
 * Categories cover: notifications, display, privacy, wallet, advanced.
 */

export const MOCK_SETTINGS = [
  {
    id: "pref-001",
    category: "notifications",
    label: "Email notifications",
    type: "toggle",
    value: "enabled",
    description: "Receive invoice lifecycle updates by email.",
  },
  {
    id: "pref-002",
    category: "notifications",
    label: "Browser push notifications",
    type: "toggle",
    value: "disabled",
    description: "Show desktop alerts for funded invoices.",
  },
  {
    id: "pref-003",
    category: "notifications",
    label: "Funding confirmation tone",
    type: "select",
    value: "chime",
    description: "Sound played when a funding attempt succeeds.",
  },
  {
    id: "pref-004",
    category: "display",
    label: "Theme",
    type: "select",
    value: "system",
    description: "Light, dark, or follow the operating system setting.",
  },
  {
    id: "pref-005",
    category: "display",
    label: "Compact list density",
    type: "toggle",
    value: "disabled",
    description: "Reduce row padding in list views.",
  },
  {
    id: "pref-006",
    category: "display",
    label: "Show yield disclaimer",
    type: "toggle",
    value: "enabled",
    description: "Display the educational yield disclaimer under each list.",
  },
  {
    id: "pref-007",
    category: "display",
    label: "Default marketplace sort",
    type: "select",
    value: "best-yield",
    description: "Sort order used on first marketplace visit.",
  },
  {
    id: "pref-008",
    category: "privacy",
    label: "Share wallet address with issuers",
    type: "toggle",
    value: "disabled",
    description: "Let the issuer see who funds an invoice.",
  },
  {
    id: "pref-009",
    category: "privacy",
    label: "Telemetry",
    type: "select",
    value: "anonymous",
    description: "Help improve the platform by sending anonymous usage signals.",
  },
  {
    id: "pref-010",
    category: "privacy",
    label: "Persistent session",
    type: "toggle",
    value: "enabled",
    description: "Keep the wallet session alive across browser restarts.",
  },
  {
    id: "pref-011",
    category: "wallet",
    label: "Default network",
    type: "select",
    value: "public",
    description: "Stellar network used when no wallet is connected.",
  },
  {
    id: "pref-012",
    category: "wallet",
    label: "Auto-confirm small payments",
    type: "toggle",
    value: "disabled",
    description: "Skip the wallet prompt for amounts below your threshold.",
  },
  {
    id: "pref-013",
    category: "wallet",
    label: "Auto-confirm threshold",
    type: "text",
    value: "0",
    description: "Maximum amount that can be auto-confirmed.",
  },
  {
    id: "pref-014",
    category: "wallet",
    label: "Transaction memo template",
    type: "text",
    value: "LiquiFact {invoiceId}",
    description: "Template applied to every send transaction memo.",
  },
  {
    id: "pref-015",
    category: "advanced",
    label: "Show developer panel",
    type: "toggle",
    value: "disabled",
    description: "Expose the in-page debug panel for power users.",
  },
  {
    id: "pref-016",
    category: "advanced",
    label: "Custom RPC endpoint",
    type: "text",
    value: "",
    description: "Override the default Stellar RPC URL.",
  },
  {
    id: "pref-017",
    category: "advanced",
    label: "Log level",
    type: "select",
    value: "warn",
    description: "Minimum severity written to the browser console.",
  },
  {
    id: "pref-018",
    category: "advanced",
    label: "Allow experimental wallets",
    type: "toggle",
    value: "disabled",
    description: "Show wallet adapters that are still in beta.",
  },
  {
    id: "pref-019",
    category: "notifications",
    label: "Settlement alerts",
    type: "toggle",
    value: "enabled",
    description: "Notify me when an invoice I funded settles.",
  },
  {
    id: "pref-020",
    category: "display",
    label: "Accent colour",
    type: "select",
    value: "cyan",
    description: "Accent colour used throughout the interface.",
  },
  {
    id: "pref-021",
    category: "privacy",
    label: "Hide balances from screenshots",
    type: "toggle",
    value: "enabled",
    description: "Blur numeric balances when taking screenshots.",
  },
  {
    id: "pref-022",
    category: "wallet",
    label: "Preferred wallet",
    type: "select",
    value: "freighter",
    description: "Wallet suggested first in the connect dialog.",
  },
  {
    id: "pref-023",
    category: "advanced",
    label: "Refresh interval",
    type: "text",
    value: "30",
    description: "Background refresh cadence, in seconds.",
  },
  {
    id: "pref-024",
    category: "notifications",
    label: "Daily digest",
    type: "toggle",
    value: "disabled",
    description: "Send one summary email per day instead of instant alerts.",
  },
  {
    id: "pref-025",
    category: "display",
    label: "Reduced motion",
    type: "toggle",
    value: "system",
    description: "Disable non-essential transitions automatically.",
  },
];

// DEV-only delay (ms) to keep the load-more cycle perceptible in dev.
const DEV_DELAY = process.env.NODE_ENV === "development" ? 80 : 0;
const SETTING_FIELDS = ["id", "category", "label", "type", "value", "description"];

// This shared fixture is read-only; callers that edit settings must own their state copy.
for (const setting of MOCK_SETTINGS) Object.freeze(setting);
Object.freeze(MOCK_SETTINGS);

function validateSettingsOverride(settings) {
  if (!Array.isArray(settings)) {
    throw new TypeError("Settings test override must be an array.");
  }

  const ids = new Set();
  for (const [index, setting] of settings.entries()) {
    if (!setting || typeof setting !== "object" || Array.isArray(setting)) {
      throw new TypeError(`Settings test override row ${index} must be an object.`);
    }

    for (const field of SETTING_FIELDS) {
      if (typeof setting[field] !== "string") {
        throw new TypeError(`Settings test override row ${index} has an invalid ${field} field.`);
      }
    }

    if (["id", "category", "label", "type"].some((field) => !setting[field].trim())) {
      throw new TypeError(`Settings test override row ${index} has an empty required field.`);
    }
    if (ids.has(setting.id)) {
      throw new TypeError(`Settings test override contains a duplicate id at row ${index}.`);
    }
    ids.add(setting.id);
  }
}

/**
 * Resolve the list of settings to display.
 *
 * Test hook: Playwright / Jest tests may override the fixture by setting
 * `window.__TEST_MOCK_SETTINGS__` before the component mounts.  The
 * override is ignored outside the browser and in production builds.
 *
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] - Abort signal honoured during
 *   the synthetic dev delay; the Promise will never throw on abort so
 *   the caller sees a clean cancel.
 * @returns {Promise<Array>}
 */
export function loadMockSettings(options = {}) {
  const signal = options?.signal;
  if (
    process.env.NODE_ENV !== "production" &&
    typeof window !== "undefined" &&
    Object.prototype.hasOwnProperty.call(window, "__TEST_MOCK_SETTINGS__")
  ) {
    const override = window.__TEST_MOCK_SETTINGS__;
    try {
      validateSettingsOverride(override);
    } catch (error) {
      return Promise.reject(error);
    }
    return Promise.resolve(override);
  }

  if (signal?.aborted) return Promise.resolve([]);

  return new Promise((resolve) => {
    let timer;
    let settled = false;
    const settle = (settings) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener?.("abort", handleAbort);
      resolve(settings);
    };
    const handleAbort = () => settle([]);

    signal?.addEventListener?.("abort", handleAbort, { once: true });
    if (signal?.aborted) {
      handleAbort();
      return;
    }
    if (settled) return;

    timer = setTimeout(() => settle(MOCK_SETTINGS), DEV_DELAY);
  });
}

/**
 * Distinct categories present in the given settings list, sorted
 * alphabetically with "all" prepended.
 *
 * @param {Array} list
 * @returns {string[]}
 */
export function getCategoryList(list) {
  if (!Array.isArray(list)) return ["all"];
  const set = new Set(
    list
      .map((setting) => setting?.category)
      .filter((category) => typeof category === "string" && category.trim().length > 0)
  );
  return ["all", ...[...set].sort()];
}

// Back-compat alias so existing call sites that reference
// `getCategories` keep building.
export { getCategoryList as getCategories };

/**
 * Find a single setting row by id.
 *
 * @param {string} id
 * @returns {object|undefined}
 */
export function getSettingById(id) {
  return MOCK_SETTINGS.find((s) => s.id === id);
}
