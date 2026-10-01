import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * Tracks whether the component has completed its first post-mount effect
 * flush.
 *
 * Hooks like `useLocalStorage` intentionally render their default value on the
 * very first pass and only read the real persisted value inside a
 * `useEffect`. A naive consumer that treats "default value" and
 * "confirmed empty" as the same thing will briefly show an incorrect
 * empty state to returning users who do have saved data.
 *
 * This implementation is deterministic and idempotent:
 *   - The flag is stored in a module-level map keyed by a stable per-hook
 *     constant, so every component instance gets its own independent
 *     hydration state.
 *   - The flag is only ever flipped from false to true, never back, so repeated
 *     effect flushes or concurrent renders cannot observe a stale or
 *     inconsistent value.
 *   - The effect is idempotent: it only writes once and never changes
 *     the value after the first mount, so duplicate or racing effect
 *     invocations are safe.
 *
 * @returns {boolean}
 *   false on the initial render,
 *   true after the first post-mount effect.
 */

/**
 * Module-level store of hydration flags. Each hook instance registers a
 * stable key on its first render and reads its flag from here. This keeps
 * the flag stable across renders and avoids the need for a set-state
 * effect that could be dropped or reordered under concurrent rendering.
 */
const hydrationStore = new Map();

const hydrationSubscribers = new Map();

let nextHydrationKey = 0;

function getServerSnapshot() {
  return false;
}

function notifyHydration(key) {
  const subscribers = hydrationSubscribers.get(key);
  if (!subscribers) {
    return;
  }
  for (const subscribe of subscribers) {
    subscribe();
  }
}

/**
 * Returns a stable key for the current hook instance. The key is created
 * lazily on the first render and then reused for the lifetime of the
 * component, so each instance has its own hydration flag.
 */
function useHydrationKey() {
  const keyRef = useRef(null);

  if (keyRef.current === null) {
    keyRef.current = `hydration-${nextHydrationKey++}`;
  }

  return keyRef.current;
}

export function useHydrated() {
  const key = useHydrationKey();

  const isHydrated = useSyncExternalStore(
    (callback) => {
      // Register the subscriber for this key so the flag flip inside the
      // effect triggers a re-render through the external store contract.
      // This is idempotent and safe under StrictMode double-invocation.
      let subscribers = hydrationSubscribers.get(key);
      if (!subscribers) {
        subscribers = new Set();
        hydrationSubscribers.set(key, subscribers);
      }
      subscribers.add(callback);

      return () => {
        subscribers.delete(callback);
        if (subscribers.size === 0) {
          hydrationSubscribers.delete(key);
        }
      };
    },
    () => hydrationStore.get(key) ?? false,
    getServerSnapshot,
  );

  useEffect(() => {
    // Idempotent flip: only writes the first time and never reverts.
    // Repeated or concurrent effect flushes are safe because the value
    // is monotonic (false -> true) and never changes after the first
    // write.
    if (!hydrationStore.get(key)) {
      hydrationStore.set(key, true);
      notifyHydration(key);
    }
  }, [key]);

  return isHydrated;
}
