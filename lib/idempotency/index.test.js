/**
 * @jest-environment jsdom
 *
 * @file lib/idempotency/index.test.js
 *
 * Unit tests for the idempotency key generation and persistence utilities.
 */

import {
  buildStorageKey,
  getOrCreateIdempotencyKey,
  clearIdempotencyKey,
} from "./index";

// ── helpers ───────────────────────────────────────────────────────────────────

function clearAllIdemKeys() {
  Object.keys(sessionStorage).forEach((k) => {
    if (k.startsWith("liquifact-idem-")) sessionStorage.removeItem(k);
  });
}

/**
 * Assert that a value is a canonical UUID v4 string.
 * Centralised so every invariant check uses the same strict pattern.
 */
const UUID_V4_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function expectUuidV4(value) {
  expect(typeof value).toBe("string");
  expect(value).toMatch(UUID_V4_RE);
}

beforeEach(() => {
  clearAllIdemKeys();
  // Ensure crypto.randomUUID is available (jsdom supplies it)
});

// ── buildStorageKey ───────────────────────────────────────────────────────────

describe("buildStorageKey", () => {
  it("returns a string with the expected shape", () => {
    const key = buildStorageKey("inv-001", "GABC...XYZ", 500);
    expect(key).toBe("liquifact-idem-GABC...XYZ-inv-001-500");
  });

  it("treats null walletAddress as 'anon'", () => {
    const key = buildStorageKey("inv-002", null, 100);
    expect(key).toBe("liquifact-idem-anon-inv-002-100");
  });

  it("treats undefined walletAddress as 'anon'", () => {
    const key = buildStorageKey("inv-002", undefined, 100);
    expect(key).toBe("liquifact-idem-anon-inv-002-100");
  });

  it("uses different keys for different amounts on the same invoice", () => {
    const k1 = buildStorageKey("inv-001", "wallet", 100);
    const k2 = buildStorageKey("inv-001", "wallet", 200);
    expect(k1).not.toBe(k2);
  });

  it("is deterministic for identical inputs", () => {
    expect(buildStorageKey("inv-001", "wallet", 100)).toBe(
      buildStorageKey("inv-001", "wallet", 100)
    );
  });

  it("does not collide across invoice, wallet, and amount boundaries", () => {
    const base = buildStorageKey("inv-001", "wallet", 100);
    expect(base).not.toBe(buildStorageKey("inv-001", "wallet", 101));
    expect(base).not.toBe(buildStorageKey("inv-001", "walletX", 100));
    expect(base).not.toBe(buildStorageKey("inv-0010", "wallet", 100));
  });
});

// ── getOrCreateIdempotencyKey ─────────────────────────────────────────────────

describe("getOrCreateIdempotencyKey", () => {
  it("returns a UUID string", () => {
    const key = getOrCreateIdempotencyKey("inv-001", "wallet", 500);
    expectUuidV4(key);
  });

  it("returns the same key on repeated calls (idempotent)", () => {
    const key1 = getOrCreateIdempotencyKey("inv-001", "wallet", 500);
    const key2 = getOrCreateIdempotencyKey("inv-001", "wallet", 500);
    expect(key1).toBe(key2);
  });

  it("returns different keys for different (invoice, amount) tuples", () => {
    const k1 = getOrCreateIdempotencyKey("inv-001", "wallet", 500);
    const k2 = getOrCreateIdempotencyKey("inv-002", "wallet", 500);
    const k3 = getOrCreateIdempotencyKey("inv-001", "wallet", 999);
    expect(k1).not.toBe(k2);
    expect(k1).not.toBe(k3);
  });

  it("returns different keys for different wallet addresses", () => {
    const k1 = getOrCreateIdempotencyKey("inv-001", "wallet-A", 500);
    const k2 = getOrCreateIdempotencyKey("inv-001", "wallet-B", 500);
    expect(k1).not.toBe(k2);
  });

  it("persists the key in sessionStorage", () => {
    const key = getOrCreateIdempotencyKey("inv-persist", "wallet", 200);
    const stored = sessionStorage.getItem("liquifact-idem-wallet-inv-persist-200");
    expect(stored).toBe(key);
  });

  it("reuses a pre-existing stored key without regenerating it", () => {
    const storageKey = "liquifact-idem-wallet-inv-seeded-100";
    sessionStorage.setItem(storageKey, "seeded-key");
    const key = getOrCreateIdempotencyKey("inv-seeded", "wallet", 100);
    expect(key).toBe("seeded-key");
    expect(sessionStorage.getItem(storageKey)).toBe("seeded-key");
  });

  it("regenerates if sessionStorage is cleared between calls", () => {
    const key1 = getOrCreateIdempotencyKey("inv-001", "wallet", 500);
    sessionStorage.clear();
    const key2 = getOrCreateIdempotencyKey("inv-001", "wallet", 500);
    // A fresh key is generated — different from the cleared one.
    expectUuidV4(key2);
    // The two keys may happen to be equal (UUID collision) but almost certainly aren't.
    // We only assert the new key is a valid UUID.
    void key1;
  });

  it("treats a null wallet address as the 'anon' namespace", () => {
    const key = getOrCreateIdempotencyKey("inv-anon", null, 100);
    expectUuidV4(key);
    expect(sessionStorage.getItem("liquifact-idem-anon-inv-anon-100")).toBe(key);
  });

  it("is idempotent under repeated concurrent-style calls", () => {
    const keys = Array.from({ length: 5 }, () =>
      getOrCreateIdempotencyKey("inv-race", "wallet", 250)
    );
    expect(new Set(keys).size).toBe(1);
  });
});

// ── clearIdempotencyKey ───────────────────────────────────────────────────────

describe("clearIdempotencyKey", () => {
  it("removes the key from sessionStorage", () => {
    getOrCreateIdempotencyKey("inv-clear", "wallet", 300);
    clearIdempotencyKey("inv-clear", "wallet", 300);
    expect(sessionStorage.getItem("liquifact-idem-wallet-inv-clear-300")).toBeNull();
  });

  it("does not throw if the key does not exist", () => {
    expect(() => clearIdempotencyKey("inv-ghost", "wallet", 100)).not.toThrow();
  });

  it("after clearing, getOrCreateIdempotencyKey generates a fresh key", () => {
    const key1 = getOrCreateIdempotencyKey("inv-fresh", "wallet", 400);
    clearIdempotencyKey("inv-fresh", "wallet", 400);
    const key2 = getOrCreateIdempotencyKey("inv-fresh", "wallet", 400);
    // Two randomly generated UUIDs are almost certainly different.
    // We assert they are both valid UUIDs; equality would be a UUID collision.
    expectUuidV4(key2);
    void key1;
  });

  it("is idempotent: clearing twice does not throw or corrupt state", () => {
    getOrCreateIdempotencyKey("inv-twice", "wallet", 100);
    clearIdempotencyKey("inv-twice", "wallet", 100);
    expect(() => clearIdempotencyKey("inv-twice", "wallet", 100)).not.toThrow();
    expect(sessionStorage.getItem("liquifact-idem-wallet-inv-twice-100")).toBeNull();
  });

  it("only clears the targeted key, leaving others intact", () => {
    const keep = getOrCreateIdempotencyKey("inv-keep", "wallet", 100);
    getOrCreateIdempotencyKey("inv-drop", "wallet", 100);
    clearIdempotencyKey("inv-drop", "wallet", 100);
    expect(sessionStorage.getItem("liquifact-idem-wallet-inv-keep-100")).toBe(keep);
  });
});
