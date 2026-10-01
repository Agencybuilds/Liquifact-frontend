import { TRUSTED_WALLET_INSTALL_URL } from "./constants";
import { copy } from "./en";

function collectUnfrozenObjectPaths(value, path = "copy", seen = new WeakSet()) {
  if (value === null || typeof value !== "object") {
    return [];
  }

  if (seen.has(value)) {
    return [];
  }

  seen.add(value);

  const failures = Object.isFrozen(value) ? [] : [path];

  Object.entries(value).forEach(([key, nestedValue]) => {
    failures.push(...collectUnfrozenObjectPaths(nestedValue, `${path}.${key}`, seen));
  });

  return failures;
}

describe("English copy dictionary", () => {
  it("deep-freezes the exported dictionary", () => {
    expect(collectUnfrozenObjectPaths(copy)).toEqual([]);
  });

  it("rejects nested mutation attempts and preserves trusted values", () => {
    const originalUrl = copy.wallet.installWalletUrl;

    expect(() => {
      copy.wallet.installWalletUrl = "http://insecure-wallet-site.com";
    }).toThrow(TypeError);
    expect(() => {
      copy.wallet.mutationProbe = "unexpected";
    }).toThrow(TypeError);

    expect(copy.wallet.installWalletUrl).toBe(originalUrl);
    expect(copy.wallet.installWalletUrl).toBe(TRUSTED_WALLET_INSTALL_URL);
    expect(copy.wallet.mutationProbe).toBeUndefined();
  });

  it("keeps duplicate and concurrent reads deterministic", async () => {
    const values = await Promise.all(
      Array.from({ length: 50 }, () => Promise.resolve(copy.wallet.installWalletUrl))
    );

    expect(new Set(values)).toEqual(new Set([TRUSTED_WALLET_INSTALL_URL]));
  });

  it("keeps repeated module executions frozen and stable", () => {
    const snapshots = [];

    for (let i = 0; i < 5; i += 1) {
      jest.isolateModules(() => {
        const { copy: isolatedCopy } = require("./en");

        snapshots.push({
          frozen: Object.isFrozen(isolatedCopy),
          walletFrozen: Object.isFrozen(isolatedCopy.wallet),
          installWalletUrl: isolatedCopy.wallet.installWalletUrl,
        });
      });
    }

    expect(snapshots).toEqual(
      Array.from({ length: 5 }, () => ({
        frozen: true,
        walletFrozen: true,
        installWalletUrl: TRUSTED_WALLET_INSTALL_URL,
      }))
    );
  });
});
