/**
 * @jest-environment jsdom
 */
import "@testing-library/jest-dom";
import { act, render, screen, fireEvent } from "@testing-library/react";
import { ToastProvider } from "./ToastProvider";
import { WalletProvider, useWallet } from "./WalletProvider";
import WalletStatus, {
  openTrustedWalletInstallUrl,
  validateWalletInstallUrl,
} from "./WalletStatus";
import { TRUSTED_WALLET_INSTALL_URL } from "../app/copy/constants";

jest.mock("@stellar/freighter-api", () => ({
  isConnected: jest.fn().mockResolvedValue(false),
  requestAccess: jest.fn(),
  getNetworkDetails: jest.fn(),
}));

function TestHarness() {
  const { state } = useWallet();
  return (
    <div>
      <div data-testid="wallet-state">{state}</div>
      <WalletStatus />
    </div>
  );
}

function renderWithProviders() {
  return render(
    <ToastProvider>
      <WalletProvider>
        <TestHarness />
      </WalletProvider>
    </ToastProvider>
  );
}

describe("WalletStatus external navigation", () => {
  let openSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    openSpy = jest.spyOn(window, "open").mockImplementation();
    errorSpy = jest.spyOn(console, "error").mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  async function connectToReachNoWalletState() {
    renderWithProviders();
    const button = screen.getByRole("button", { name: /connect wallet/i });

    fireEvent.click(button);

    // Allow the async connect flow to resolve
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("opens the trusted wallet URL with noopener and noreferrer", async () => {
    await connectToReachNoWalletState();

    const installButton = screen.getByRole("button", { name: /install/i });
    fireEvent.click(installButton);

    expect(openSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith(
      TRUSTED_WALLET_INSTALL_URL,
      "_blank",
      "noopener,noreferrer"
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("validates trusted and rejected wallet install URLs deterministically", () => {
    expect(validateWalletInstallUrl(TRUSTED_WALLET_INSTALL_URL)).toEqual({
      ok: true,
      href: TRUSTED_WALLET_INSTALL_URL,
    });
    expect(validateWalletInstallUrl("")).toEqual({
      ok: false,
      reason: "missing-url",
    });
    expect(validateWalletInstallUrl("not a url")).toEqual({
      ok: false,
      reason: "invalid-url",
    });
    expect(validateWalletInstallUrl("javascript:alert(1)")).toEqual({
      ok: false,
      reason: "non-https-url",
      protocol: "javascript:",
    });
  });

  it("blocks an insecure URL and logs non-sensitive diagnostics", () => {
    const result = openTrustedWalletInstallUrl(
      "http://insecure-wallet-site.com/path?token=secret"
    );

    expect(result).toBe(false);
    expect(openSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith("Blocked unsafe wallet install URL.", {
      reason: "non-https-url",
      protocol: "http:",
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("token=secret");
  });
});
