import type { ConnectionQuality } from "../../../../packages/shared/src/protocol";
import { QUALITY_LABEL } from "../utils/quality";

export function ConnectionBadge({ quality }: { quality: ConnectionQuality }) {
  return (
    <span className={`badge q-${quality}`}>
      <span className="dot" />
      {QUALITY_LABEL[quality]}
    </span>
  );
}
