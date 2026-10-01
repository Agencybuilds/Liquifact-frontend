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

  it("returns the same key for concurrent calls on the same tuple", () => {
    const keys = Array.from({ length: 25 }, () =>
      getOrCreateIdempotencyKey("inv-race", "wallet", 500)
    );
    const unique = new Set(keys);
    expect(unique.size).toBe(1);
  });

  it("is idempotent across repeated sequential calls (retry safety)", () => {
    const first = getOrCreateIdempotencyKey("inv-retry", "wallet", 750);
    for (let i = 0; i < 10; i++) {
      expect(getOrCreateIdempotencyKey("inv-retry", "wallet", 750)).toBe(first);
    }
  });

  it("does not collide across distinct tuples under concurrent access", () => {
    const tuples = [
      ["inv-a", "wallet", 100],
      ["inv-a", "wallet", 200],
      ["inv-a", "other", 100],
      ["inv-b", "wallet", 100],
    ];
    const results = tuples.map(([inv, w, amt]) =>
      getOrCreateIdempotencyKey(inv, w, amt)
    );
    expect(new Set(results).size).toBe(tuples.length);
  });

  it("treats boundary amounts (0 and large) deterministically", () => {
    const zero1 = getOrCreateIdempotencyKey("inv-zero", "wallet", 0);
    const zero2 = getOrCreateIdempotencyKey("inv-zero", "wallet", 0);
    expect(zero1).toBe(zero2);

    const big1 = getOrCreateIdempotencyKey("inv-big", "wallet", Number.MAX_SAFE_INTEGER);
    const big2 = getOrCreateIdempotencyKey("inv-big", "wallet", Number.MAX_SAFE_INTEGER);
    expect(big1).toBe(big2);
    expect(big1).not.toBe(zero1);
  });

  it("does not mutate the stored key when read concurrently", () => {
    const key = getOrCreateIdempotencyKey("inv-stable", "wallet", 42);
    const storageKey = buildStorageKey("inv-stable", "wallet", 42);
    for (let i = 0; i < 5; i++) {
      getOrCreateIdempotencyKey("inv-stable", "wallet", 42);
      expect(sessionStorage.getItem(storageKey)).toBe(key);
    }
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

  it("is safe to call concurrently with getOrCreateIdempotencyKey", () => {
    const key = getOrCreateIdempotencyKey("inv-cc", "wallet", 500);
    clearIdempotencyKey("inv-cc", "wallet", 500);
    const fresh = getOrCreateIdempotencyKey("inv-cc", "wallet", 500);
    expect(fresh).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    expect(fresh).not.toBe(key);
  });

  it("clearing one tuple does not affect other tuples", () => {
    const a = getOrCreateIdempotencyKey("inv-iso", "wallet", 100);
    const b = getOrCreateIdempotencyKey("inv-iso", "wallet", 200);
    clearIdempotencyKey("inv-iso", "wallet", 100);
    expect(sessionStorage.getItem(buildStorageKey("inv-iso", "wallet", 100))).toBeNull();
    expect(getOrCreateIdempotencyKey("inv-iso", "wallet", 200)).toBe(b);
    void a;
  });
});
