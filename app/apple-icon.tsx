import { ImageResponse } from "next/og";

export const runtime = "edge";

export const size = {
  width: 180,
  height: 180,
};
export const contentType = "image/png";

/**
 * Protects state invariants for the Apple icon generation.
 * Ensures the icon is generated deterministically and handles potential
 * rendering failures gracefully to avoid unrecoverable user experiences.
 */
export default function AppleIcon() {
  try {
    // Validate size invariant
    if (!size || size.width !== 180 || size.height !== 180) {
      throw new Error("Invalid size invariant for AppleIcon");
    }

    return new ImageResponse(
      <div
        style={{
          fontSize: 100,
          background: "#020617", // slate-950
          color: "#22d3ee", // cyan-400
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "20%",
          fontWeight: 800,
        }}
      >
        L
      </div>,
      {
        ...size,
      }
    );
  } catch (error) {
    // Fallback response for invariant violations or rendering errors
    console.error("AppleIcon generation failed:", error);
    return new Response("Failed to generate icon", { status: 500 });
  }
}
