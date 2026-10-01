/**
 * Layout for all /invest routes.
 *
 * Wraps the list page and detail page with MarketplaceShell so that
 * invoice state (including optimistic updates) is shared across navigations
 * within the marketplace.
 *
 * The layout is also the single recovery boundary for the whole
 * /invest subtree. Wrapping the shell in MarketplaceErrorBoundary
 * ensures that a render failure in any nested route is caught at the
 * layout level, logged through the shared reporter, and recoverable
 * via the retry action without losing the shell's in-memory state.
 *
 * Invariants:
 *  - The boundary is mounted outside the shell, so a failure in
 *    a child route never unmounts the shell or its providers.
 *  - Retry is deterministic: the boundary resets its error state and
 *    re-renders the same children without any side effects.
 *  - Failures are observable through the shared reporter (component
 *    stack + boundary tag), with sensitive keys redacted.
 */
import MarketplaceErrorBoundary from "../../components/MarketplaceErrorBoundary";

export default function InvestLayout({ children }) {
  return <MarketplaceErrorBoundary>{children}</MarketplaceErrorBoundary>;
}
