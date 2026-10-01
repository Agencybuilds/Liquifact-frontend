
/**
 * Centralized constants for the application.
 *
 * This module is a public compatibility contract. The exported names, their
 * types, and their values are consumed by other modules and tests. Any
 * change here must preserve those contracts or ship a tested migration
 * path.
 *
 * Invariants:
 *   1. Every exported constant is a non-empty string.
 *   2. Exported names are stable and never removed without a migration note.
 *   3. Values are deterministic and safe to read at module load time.
 */

/**
 * Public wallet installation URL shown to users who do not yet have a
 * Stellar wallet. Keep this value in sync with the official Stellar wallet
 * directory.
 */
export const TRUSTED_WALLET_INSTALL_URL = "https://www.stellar.org/wallets";


/**
 * Human-readable labels for every wallet connection status. This object
 * is part of the public copy contract: external consumers read each key
 * and expect a non-empty string. New keys may be added, but existing
 * keys must not be removed or renamed without a migration note.
 *
 * The object is frozen so accidental mutation at runtime cannot silently
 * break the contract for other modules.
 */
export const WALLET_STATUS_COPY = Object.freeze({
  connected: "Connected",
  connecting: "Connecting...",
  disconnected: "Disconnected",
  error: "Connection error",
  unknown: "Unknown status",
});

/**
 * All constants exported by this module. Used by compatibility tests to
 * guarantee that no export is accidentally removed or renamed.
 */
export const CONSTANTS = Object.freeze({
  TRUSTED_WALLET_INSTALL_URL,
  WALLET_STATUS_COPY,
});
