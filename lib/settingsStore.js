// @ts-check

/** localStorage key where user settings are persisted. */
export const SETTINGS_STORAGE_KEY = "liquifact-settings";

/** localStorage key where the last-changed timestamp (ms epoch) is persisted. */
export const SETTINGS_UPDATED_KEY = "liquifact-settings-updated";

/** @type {{currency: 'USD'|'EUR'|'NGN', emailNotifications: boolean}} */
export const DEFAULT_SETTINGS = {
  currency: "USD",
  emailNotifications: true,
};

/** Allowed currency values. */
export const ALLOWED_CURRENCIES = ["USD", "EUR", "NGN"];

/**
 * Error class thrown when settings persistence fails. Carries a
 * machine-readable code so callers can react deterministically without
 * parsing human-messages.
 */
export class SettingsPersistenceError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {{underlying?: unknown}} [options]
   */
  constructor(code, message, options = {}) {
    super(message);
    this.name = "SettingsPersistenceError";
    this.code = code;
    if (options.underlying !== undefined) {
      this.underlying = options.underlying;
    }
  }
}

/**
 * Resolve the active localStorage implementation. Returns null when
 * not available (SSR, tests, non-browser environments).
 *
 * @typedef {Storage | null}
 */
function getStorage() {
  try {
    if (typeof localStorage === "undefined" || localStorage == null) {
      return null;
    }
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * Normalize an arbitrary input into a valid settings object. Unknown
 * keys are dropped and invalid values fall back to defaults. This keeps
 * persisted state deterministic and prevents corrupt data from leaking
 * into the UI.
 *
 * @param {unknown} candidate
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function normalizeSettings(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ...DEFAULT_SETTINGS };
  }

  const next = { ...DEFAULT_SETTINGS };

  if (ALLOWED_CURRENCIES.includes(candidate.currency)) {
    next.currency = candidate.currency;
  }

  if (typeof candidate.emailNotifications === "boolean") {
    next.emailNotifications = candidate.emailNotifications;
  }

  return next;
}

/**
 * Read persisted settings from localStorage, merged over the defaults so
 * missing/older keys don't break the UI. Safe to call from the browser only.
 *
 * This function is pure with respect to its return value: it never throws
 * and always returns a normalized object, even when storage is
 * unavailable or corrupt.
 *
 * @returns {typeof DEFAULT_SETTINGS}
 */
export function readStoredSettings() {
  const storage = getStorage();
  if (!storage) return { ...DEFAULT_SETTINGS };

  try {
    const raw = storage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return normalizeSettings(parsed);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Persist settings to localStorage deterministically. Validates and
 * normalizes the input before writing, then reads it back to confirm the
 * write succeeded. Throws a SettingsPersistenceError on failure so the
 * callers can surface a user-visible error and retry without losing
 * in-memory state.
 *
 * @param {typeof DEFAULT_SETTINGS} settings
 * @returns {typeof DEFAULT_SETTINGS} the normalized value that was persisted
 * @throws {SettingsPersistenceError}
 */
export function writeStoredSettings(settings) {
  const normalized = normalizeSettings(settings);
  const storage = getStorage();
  if (!storage) {
    throw new SettingsPersistenceError(
      "STORAGE_UNAVAILABLE",
      "Settings could not be saved: browser storage is unavailable.",
    );
  }

  const serialized = JSON.stringify(normalized);

  try {
    storage.setItem(SETTINGS_STORAGE_KEY, serialized);
  } catch (underlying) {
    throw new SettingsPersistenceError(
      "STORAGE_WRITE_FAILED",
      "Settings could not be saved. Please retry.",
      { underlying },
    );
  }

  // Verify the write landed correctly. Some environments (e.g. quota
  // exceeded, private mode) accept setItem without persisting.
  try {
    const readBack = storage.getItem(SETTINGS_STORAGE_KEY);
    if (readBack !== serialized) {
      throw new SettingsPersistenceError(
        "STORAGE_VERIFY_FAILED",
        "Settings did not persist correctly. Please retry.",
      );
    }
  } catch (err) {
    if (err instanceof SettingsPersistenceError) throw err;
    throw new SettingsPersistenceError(
      "STORAGE_VERIFY_FAILED",
      "Settings could not be verified after saving. Please retry.",
      { underlying: err },
    );
  }

  return normalized;
}

/**
 * Read the last-changed timestamp for settings from localStorage.
 *
 * @returns {number|null} ms since epoch, or null if never recorded / unavailable.
 */
export function readStoredSettingsUpdatedAt() {
  const storage = getStorage();
  if (!storage) return null;

  try {
    const stored = storage.getItem(SETTINGS_UPDATED_KEY);
    const parsed = stored ? Number(stored) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Persist the last-changed timestamp for settings. Throws a SettingsPersistenceError on failure so the caller can recover or report.
 *
 * @param {number} updatedAt - ms since epoch
 * @returns {number} the persisted timestamp
 * @throws {SettingsPersistenceError}
 */
export function writeStoredSettingsUpdatedAt(updatedAt) {
  if (!Number.isFinite(updatedAt)) {
    throw new SettingsPersistenceError(
      "INVALID_TIMESTAMP",
      "Settings timestamp must be a finite number.",
    );
  }

  const storage = getStorage();
  if (!storage) {
    throw new SettingsPersistenceError(
      "STORAGE_UNAVAILABLE",
      "Settings timestamp could not be saved: browser storage is unavailable.",
    );
  }

  try {
    storage.setItem(SETTINGS_UPDATED_KEY, String(updatedAt));
  } catch (underlying) {
    throw new SettingsPersistenceError(
      "STORAGE_WRITE_FAILED",
      "Settings timestamp could not be saved. Please retry.",
      { underlying },
    );
  }

  return updatedAt;
}
