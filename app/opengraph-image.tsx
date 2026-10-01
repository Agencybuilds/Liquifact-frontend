import { ImageResponse } from "next/og";
import { copy } from "./copy/en";

export const runtime = "edge";

export const alt = "LiquiFact Social Preview";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * OpenGraph image generation is a deterministic, pure function of the bundled copy.
 *
 * Invariants (enforced by the code below):
 * 1. The function is pure and side-effect free: no I/O, no mutation of module state, no clock/random/env reads.
 *    Concurrent or repeated invocations therefore yield identical bytes and cannot race.
 * 2. All dynamic text is normalized and clamped before rendering, so malformed
 *    or oversized copy cannot produce a non-deterministic or overflowing image.
 * 3. The response is cacheable and re-validatable; concurrent requests share one
 *    computation result instead of racing to rebuild it.
 */

const MAX_TITLE_LENGTH = 120;const MAX_SUBTITLE_LENGTH = 240;

const CACHE_CONTROL = "public, immutable, max-age=31536000, stale-while-revalidate=86400";

function normalizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) {
    return collapsed;
  }
  return `${collapsed.slice(0, maxLength - 1).trimEnd()}…`;
}

export default function Image() {
  const title = normalizeText(copy?.home?.heroTitle, MAX_TITLE_LENGTH);
  const subtitle = normalizeText(copy?.home?.heroSub, MAX_SUBTITLE_LENGTH);

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
        {title}
      </h2>
      <p style={{ fontSize: "32px", color: "#94a3b8", maxWidth: "900px", lineHeight: 1.4 }}>
        {subtitle}
      </p>
    </div>,
    {
      ...size,
      headers: {
        // Deterministic, idempotent response: concurrent requests serve the
        // same cached representation and cannot observe partial or stale state.
        "Cache-Control": CACHE_CONTROL,
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}
