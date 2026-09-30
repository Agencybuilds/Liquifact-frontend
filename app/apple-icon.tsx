import { ImageResponse } from "next/og";

export const runtime = "edge";

export const size = {
  width: 180,
  height: 180,
};
export const contentType = "image/png";

export default function AppleIcon() {
  try {
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
    console.error("Failed to generate apple-icon:", error);
    return new ImageResponse(
      <div
        style={{
          fontSize: 100,
          background: "#020617",
          color: "#22d3ee",
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        L
      </div>,
      {
        ...size,
      }
    );
  }
}
