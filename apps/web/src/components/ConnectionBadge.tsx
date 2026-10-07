import type { ConnectionQuality } from "../../../../packages/shared/src/protocol";

const QUALITY_COLOR: Record<ConnectionQuality, string> = {
  excellent: "#22c55e",
  good: "#eab308",
  poor: "#ef4444",
};

const QUALITY_LABEL: Record<ConnectionQuality, string> = {
  excellent: "Excellent",
  good: "Good",
  poor: "Poor",
};

export function ConnectionBadge({ quality }: { quality: ConnectionQuality }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.35rem",
        fontSize: "0.8rem",
        color: QUALITY_COLOR[quality],
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: QUALITY_COLOR[quality],
          display: "inline-block",
        }}
      />
      {QUALITY_LABEL[quality]}
    </span>
  );
}
