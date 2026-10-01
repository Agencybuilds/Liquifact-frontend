"tuse client";

import { useState, useRef, useEffect, useContext } from "react";
import Button from "./Button";
import { copy } from "../app/copy/en";
import { WalletContext, WALLET_STATES, truncateAddress } from "./WalletProvider";
import { useToast } from "./ToastProvider";
import { copyToClipboard } from "../lib/clipboard";
import WalletSkeleton from "./WalletSkeleton";
import { formatWalletBalance } from "../lib/format/currency";
import DensityToggle from "./DensityToggle";
import { useDensity } from "../lib/hooks/useDensity";

/** Spacing variants driven by the density preference. */
const WALLET_SPACING = {
  compact: { gap: "gap-1", padding: "p-2" },
  comfortable: { gap: "gap-3", padding: "p-4" },
};

/**
 * Compatibility contract for wallet copy keys.
 *
 * `app/copy/constants.js` (and the `copy` object imported from
 * `app/copy/en`) is a public compatibility surface: downstream consumers
 * (tests, analytics, i18n tooling, and other components) read these keys
 * directly. To preserve that contract through upgrades, errors, and empty
 * data we resolve every key through a single, deterministic accessor that:
 *
 *   1. Never throws when a key is missing (returns the provided fallback).
 *   2. Never returns `undefined` for a string-typed contract (falls back).
 *   3. Coerces non-string values to a safe string so downstream rendering
 *      and `aria-label`/`aria-describedby` remain well-formed.
 *   4. Is pure and side-effect free, so it is safe under concurrent render,
 *      retries, and StrictMode double-invocation.
 *
 * Invariant: for any `key`, `resolveCopy(key, fallback)` returns a string.
 * @param {string} key - Dotted path into the `copy` object, e.g. "wallet.connectButton".
 * @param {string} fallback - Non-empty fallback used when the key is absent or invalid.
 * @returns {string}
 */
function resolveCopy(key, fallback) {
  const safeFallback = typeof fallback === "string" && fallback.length > 0 ? fallback : "";
  if (typeof key !== "string" || key.length === 0) return safeFallback;
  const segments = key.split(".");
  let current = copy;
  for (const segment of segments) {
    if (current == null || typeof current !== "object") return safeFallback;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return safeFallback;
    current = current[segment];
  }
  if (typeof current === "string") return current;
  if (current == null) return safeFallback;
  return String(current);
}

/**
 * Returns a concise, non-sensitive announcement string for a wallet state
 * transition. Returns null when no announcement is warranted (e.g. connecting
 * state, which has its own visible spinner).
 * @param {string} nextState
 * @returns {string|null}
 */
function getTransitionAnnouncement(nextState) {
  switch (nextState) {
    case WALLET_STATES.CONNECTED:
      return resolveCopy("wallet.announceConnected", "");
    case WALLET_STATES.DISCONNECTED:
      return resolveCopy("wallet.announceDisconnected", "");
    case WALLET_STATES.ERROR:
      return resolveCopy("wallet.announceError", "");
    case WALLET_STATES.WRONG_NETWORK:
      return resolveCopy("wallet.announceWrongNetwork", "");
    case WALLET_STATES.INVALID_PROVIDER:
      return resolveCopy("wallet.announceInvalidProvider", "");
    case WALLET_STATES.NO_WALLET;
      return resolveCopy("wallet.announceNoWallet", "");
    default:
      return null;
  }
}

/**
 * Maps the current wallet state to a configuration object that drives the
 * Button's appearance and the surrounding helper text.
 *
 * Key mapping contract:
 *   - “buttonVariant`” → forwarded directly as `variant` to <Button>.
 *     Must be one of the valid Button variants: "primary" | "secondary" |
 *     "warning" | "external" | "danger". The "loading" string is NOT a valid
 *     Button variant — the loading spinner is handled separately via the
 *     `loading` prop (derived from `state === WALLET_STATES.CONNECTING`).
 *   - “buttonText”    → rendered as the Button's child text and aria-label.
 *   - “helperText”    → displayed in the `#wallet-helper-text` span beneath
 *     the status dot, and referenced by the Button's aria-describedby (only
 *     when the address is not shown, i.e., when the span is present in the DOM).
 *   - `disabled`      → forwarded as `disabled` to <Button>; true while
 *     connecting so the user cannot click mid-flight.
 *   - `showAddress`   → when true, display walletData.address/balance instead
 *     of helperText. The `#wallet-helper-text` span is NOT rendered in this
 *     case so aria-describedby must be omitted.
 *
 * @param {string} currentState - One of the WALLET_STATES values.
 * @param {{network?: string} |null} walletData - Current wallet data.
 * @param {string | null} error - Current wallet error message, if any.
 * @returns {{
 *   buttonText: string,
 *   buttonVariant: 'primary'|'secondary'|'warning'|'external'|'danger',
 *   helperText: string,
 *   disabled: boolean,
 *   showAddress: boolean,
 * }}
 */
function getStateConfig(currentState, walletData, error) {
  switch (currentState) {
    case WALLET_STATES.DISCONNECTED:
      return {
        buttonText: resolveCopy("wallet.connectButton", "Connect Wallet"),
        // Primary action: use "primary" variant (cyan).
        buttonVariant: "primary",
        helperText: resolveCopy("wallet.helperDisconnected", "No wallet connected."),
        disabled: false,
        showAddress: false,
      };

    case WALLET_STATES.CONNECTING:
      return {
        buttonText: resolveCopy("wallet.connectingButton", "Connecting..."),
        // "loading" is NOT a Button variant. Use "primary" here and rely on
        // `loading={state === WALLET_STATES.CONNECTING}` to render the Spinner
        // and set aria-busy on the button element.
        buttonVariant: "primary",
        helperText: resolveCopy("wallet.helperConnecting", "Connecting wallet..."),
        disabled: true,
        showAddress: false,
      };

    case WALLET_STATES.CONNECTED:
      return {
        buttonText: resolveCopy("wallet.disconnectButton", "Disconnect"),
        buttonVariant: "secondary",
        helperText: resolveCopy("wallet.helperConnected", "Connected to {network}").replace(
          "{network}",
          walletData?.network || "public"
        ),
        disabled: false,
        // Address/balance row replaces helper text — the #wallet-helper-text
        // span is not rendered in this state, so aria-describedby is omitted.
        showAddress: true,
      };

    case WALLET_STATES.ERROR:
      return {
        buttonText: resolveCopy("wallet.retryButton", "Retry"),
        buttonVariant: "primary",
        helperText: error || resolveCopy("wallet.helperError", "Wallet connection failed."),
        disabled: false,
        showAddress: false,
      };

    case WALLET_STATES.WRONG_NETWORK:
      return {
        buttonText: resolveCopy("wallet.switchNetworkButton", "Switch Network"),
        buttonVariant: "warning",
        helperText: error || resolveCopy("wallet.helperWrongNetwork", "Wrong network."),
        disabled: false,
        showAddress: false,
      };

    case WALLET_STATES.INVALID_PROVIDER:
      return {
        buttonText: resolveCopy("wallet.retryButton", "Retry"),
        buttonVariant: "danger",
        helperText: error || resolveCopy("wallet.helperInvalidProvider", "Invalid wallet provider."),
        disabled: false,
        showAddress: false,
      };

    case WALLET_STATES.NO_WALLET:
      return {
        buttonText: resolveCopy("wallet.installWalletButton", "Install Wallet"),
        buttonVariant: "external",
        helperText: resolveCopy("wallet.helperNoWallet", "No wallet detected."),
        disabled: false,
        showAddress: false,
      };

    default:
      return getStateConfig(WALLET_STATES.DISCONNECTED, walletData, error);
  }
}

export default function WalletStatus() {
  const context = useContext(WalletContext);
  const { state, walletData, error, hydrating, connect, disconnect } = context || {
    state: WALLET_STATES.DISCONNECTED,
    walletData: null,
    error: null,
    connect: async () => ({ outcome: "error" }),
    disconnect: () => {},
  };
  const toast = useToast();
  const [density, setDensity] = useDensity();
  const spacing = WALLET_SPACING[density] ?? WALLET_SPACING.comfortable;

  /**
   * Derive the Button props from the current wallet state.
   *
   * `buttonVariant` maps directly to <Button variant={...}>.
   * The `loading` prop is derived separately: it is true only while connecting
   * so Button renders its own Spinner and sets aria-busy automatically.
   * No inline spinner SVG is needed here.
   */
  const config = getStateConfig(state, walletData, error);

  // Track state transitions to announce them once via the polite live region.
  const prevStateRef = useRef(state);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");

  useEffect(() => {
    const prev = prevStateRef.current;
    if (prev !== state) {
      prevStateRef.current = state;
      const msg = getTransitionAnnouncement(state);
      if (msg) {
        // Defer all setState to avoid triggering react-hooks/set-state-in-effect.
        // Briefly clear then set so the same message re-announces if the
        // user toggles connect/disconnect repeatedly.
        const id = setTimeout(() => {
          setLiveAnnouncement("");
          queueMicrotask(() => setLiveAnnouncement(msg));
        }, 0);
        return () => clearTimeout(id);
      }
    }
  }, [state]);

  // Show skeleton while WalletProvider is rehydrating from localStorage.
  // This prevents the layout from shifting from the placeholder (shown by
  // WalletStatusLazy while the JS chunk loads) to a transient DISCONNECTED
  // state before the persisted snapshot is applied.
  if (hydrating) {
    return <WalletSkeleton />;
  }

  const handleCopyAddress = async () => {
    if (!walletData?.address) return;
    try {
      await copyToClipboard(walletData.address);
      toast.success(resolveCopy("wallet.toastCopySuccessMsg", "Address copied."), resolveCopy("wallet.toastCopySuccessTitle", "Copied"));
    } catch {
      toast.error(resolveCopy("wallet.toastCopyErrorMsg", "Failed to copy address."), resolveCopy("wallet.toastCopyErrorTitle", "Copy failed"));
    }
  };

  const handleClick = () => {
    switch (state) {
      case WALLET_STATES.DISCONNECTED:
      case WALLET_STATES.ERROR:
      case WALLET_STATES.WRONG_NETWORK:
      case WALLET_STATES.INVALID_PROVIDER:
        void connect();
        break;

      case WALLET_STATES.CONNECTED:
        disconnect();
        break;

      case WALLET_STATES.NO_WALLET:
        {
          const url = resolveCopy("wallet.installWalletUrl", "");
          // Only allow https URLs for security
          if (typeof url === "string" && url.startsWith("https://")) {
            window.open(url, "_blank", "noopener,noreferrer");
          } else {
            console.error(
              "Blocked attempt to open a non-HTTPS wallet URL for security reasons:",
              url
            );
          }
        }
        break;

      default:
        break;
    }
  };

  // The #wallet-helper-text span is only present when showAddress is false.
  // aria-describedby must only reference an element that exists in the DOM —
  // omit it when the connected address row is shown instead.
  const helperTextId = config.showAddress ? undefined : "wallet-helper-text";

  return (
    <div className="flex flex-row-reverse items-center justify-end gap-4">
      {/*
       * Wallet action button.
       * Placed first in the DOM for sensible focus order, but visually on the right
       * via flex-row-reverse.
       *
       * variant={config.buttonVariant}
       *   Drives visual style. Always a valid Button variant string:
       *   "primary" | "secondary" | "warning" | "external" | "danger".
       *
       * loading={state === WALLET_STATES.CONNECTING}
       *   Renders Button's built-in Spinner
       */}
      <Button
        variant={config.buttonVariant}
        onClick={handleClick}
        disabled={config.disabled}
        loading={state === WALLET_STATES.CONNECTING}
        aria-describedby={helperTextId}
      >
        {config.buttonText}
      </Button>
    </div>
  );
}
