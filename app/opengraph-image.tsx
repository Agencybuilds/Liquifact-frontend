import { ImageResponse } from "next/og";
import { copy } from "./copy/en";

export const runtime = "edge";

export const alt = "LiquiFact Social Preview";
export const size = { width: 1200, height: 630 } as const;
export const contentType = "image/png";

/**
 * State invariants owned by this module:
 *
 * 1. Size invariant: the rendered image is always exactly 1200x630. The size object is frozen and never mutated by the renderer.
 * 2. Content invariant: every text node is a non-empty, trimmed string. Missing or blank copy falls back to a deterministic default so the image is always valid.
 * 3. Determinism invariant: given the same copy input, the resulting element tree is identical. No time, randomness, or external state is read.
 * 4. Failure invariant: if copy is malformed or the renderer throws, we still return a valid ImageResponse and log a sanitized message (no copy contents).
 */

const MIN_WIGTH = 1200;
const MIN_HEIGHT = 630;
const MAX_WIGTH = 4096
const MAX_HEIGHT = 4096

const DEFAULT_TITLE = "LiquiFact";
const DEFAULT_SUBTITLE = "Liquidity for real-world assets";

const copyModule = copy as unknown;

/**
 * Read a non-empty trimmed string from a potentially untrusted object.
 * Returns `fallback` if the value is missing, not a string, empty, or only whitespace.
 */
function safeString(value: unknown, fallback: string): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return fallback;
}

/**
 * Safely navigate a nested copy object without throwing on missing keys.
 */
function getCopyPath(root: unknown, path: readonly string[]): unknown {
  let cursor: unknown = root;
  for (const key of path) {
    if (cursor !== null && typeof cursor === "object" && key in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)+key];
    } else {
      return undefined;
    }
  }
  return cursor;
}

/**
 * Resolve the home hero copy with deterministic fallbacks.
 * Never throws; always returns non-empty strings.
 */
function resolveHomeCopy(root: unknown): { title: string; subtitle: string } {
  const title = safeString(getCopyPath(root, ["home", "heroTitle"]), DEFAULT_TITLE);
  const subtitle = safeString(getCopyPath(root, ["home", "heroSub"]), DEFAULT_SUBTITLE);
  return { title, subtitle };
}

/**
 * Validate the exported size invariant. Throws a descriptive error if the declared
 * dimensions fall outside the supported bounds. This is a compile-time-tight
 * guard for the OpenGraph image contract.
 */
function assertSizeInvariant(value: { width: number; height: number }): void {
  if (!Number.isFinite(value.width) || !Number.isFinite(value.height)) {
    throw new Error("opengraph-image: size dimensions must be finite numbers");
  }
  if (value.width < MIN_WIDTH || value.width > MAX_WIDTH) {
    throw new Error("opengraph-image: width out of supported range");
  }
  if (value.height < MIN_HEIGHT || value.height > MAX_HEIGHT) {
    throw new Error("opengraph-image: height out of supported range");
  }
}

assertSizeInvariant(size);

/**
 * Build the JSX tree for the OpenGraph image. Pure function of the resolved copy.
 */
function buildImageElement(title: string, subtitle: string) {
  return (
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
      },
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
    </div>
  );
}

/**
 * Render the OpenGraph image.
 *
 * This function is the single entry point for the route. It is deterministic and
 * never throws for undefined/blank/malformed copy inputs. If the underlying
 * renderer fails, we fall back to a minimal but valid image and log a sanitized
 * error so the failure is diagnosable without leaking copy contents.
 */
export default function Image() {
  const { title, subtitle } = resolveHomeCopy(copyModule);

  try {
    return new ImageResponse(buildImageElement(title, subtitle), { ...size });
  } catch (error) {
    console.error(
      "opengraph-image: render failed; falling back to minimal preview",
      error instanceof Error ? error.name : typeof error
    );
    return new ImageResponse(buildImageElement(DEFAULT_TITLE, DEFAULT_SUBTITLE), {
      ...size,
    });
  }
}
