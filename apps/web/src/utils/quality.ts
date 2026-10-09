import type { ConnectionQuality } from "../../../../packages/shared/src/protocol";

export const QUALITY_LABEL: Record<ConnectionQuality, string> = {
  excellent: "Excellent",
  good: "Good",
  poor: "Poor",
};

const SEVERITY: Record<ConnectionQuality, number> = { excellent: 0, good: 1, poor: 2 };

/** The worst quality in a list — one bad peer is what the user should notice. */
export function worstQuality(qualities: ConnectionQuality[]): ConnectionQuality {
  return qualities.reduce<ConnectionQuality>(
    (worst, q) => (SEVERITY[q] > SEVERITY[worst] ? q : worst),
    "excellent"
  );
}
