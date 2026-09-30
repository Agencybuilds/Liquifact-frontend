import { ImageResponse } from "next/og";
import { copy } from "./copy/en";
import { reportError } from "../lib/observability/reportError";

export const runtime = "edge";

export const alt = "LiquiFact Social Preview";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * Deterministic failure recovery for the social preview image.
 *
 * Invariants:
 * -  The route always returns a valid PNG image response or throws a
 *    deterministic error that is reported through the observability sink.
 * -  A failure in the primary render path falls back to a minimal, static
 *    render that does not depend on external copy or font resolution.
 * -  The fallback is itself guarded, so a failure in the fallback is logged
 *    and surfaced as a controlled error rather than a silent empty response.
 * -  Rendering is pure and has no mutable module-level state, so concurrent
 *    invocations cannot interfere with each other.
 */

type Renderer = () => Response;

const FALLBACK_CONTEXT = { route: "/opengraph-image", operation: "render" } as const;

function renderPrimary(): Response {
  return new ImageResponse(
    <div
      style={{
        background: "#020617", // slate-950
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "80px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: "40px" }}>
        <div
          style={{
            background: "#22d3ee", // cyan-400
            color: "#020617",
            width: "80px",
            height: "80px",
            borderRadius: "20%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "48px",
            fontWeight: 800,
            marginRight: "24px",
          }}
        >
          L
        </div>
        <h1 style={{ fontSize: "64px", fontWeight: 800, margin: 0, color: "#f8fafc" }}>
          LiquiFact
        </h1>
      </div>
      <h2
        style={{
          fontSize: "56px",
          fontWeight: 700,
          marginBottom: "24px",
          lineHeight: 1.2,
          color: "#22d3ee",
        }}
      >
        {copy.home.heroTitle}
      </h2>
      <p style={{ fontSize: "32px", color: "#94a3b8", maxWidth: "900px", lineHeight: 1.4 }}>
        {copy.home.heroSub}
      </p>
    </div>,
    {
      ...size,
    }
  );
}

function renderFallback(): Response {
  return new ImageResponse(
    <div
      style={{
        background: "#020617",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#f8fafc",
        fontSize: "72px",
        fontWeight: 800,
      }}
    >
      LiquiFact
    </div>,
    {
      ...size,
    }
  );
}

/**
 * Runs a renderer with a deterministic fallback. The first failure is
 * reported with scrubbed context, then the fallback is attempted. If the
 * fallback also fails, the error is reported and re-thrown so the route
 * fails visibly instead of serving a corrupt or empty image.
 */
function renderWithRecovery(primary: Renderer, fallback: Renderer): Response {
  try {
    return primary();
  } catch (error) {
    reportError(error, { ...FALLBACK_CONTEXT, phase: "primary" });
  }

  try {
    return fallback();
  } catch (fallbackError) {
    reportError(fallbackError, { ...FALLBACK_CONTEXT, phase: "fallback" });
    throw fallbackError;
  }
}

export default function Image() {
  return renderWithRecovery(renderPrimary, renderFallback);
}
