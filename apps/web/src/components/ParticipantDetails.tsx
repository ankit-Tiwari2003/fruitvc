import type { CSSProperties } from "react";
import type { Participant } from "../../../../packages/shared/src/protocol";
import type { ConnectionStats } from "../webrtc/ConnectionMonitor";
import { ConnectionBadge } from "./ConnectionBadge";
import { StatRow } from "./StatRow";
import { participantColor } from "../utils/identity";
import { bytesToKbps, formatJitter, formatKbps, formatRtt } from "../utils/format";
import { useStalled } from "../hooks/useStalled";

/** Full stats for the participant picked with a card's Select button. */
export function ParticipantDetails({ participant, stats }: { participant: Participant; stats?: ConnectionStats }) {
  const style = { "--tile-color": participantColor(participant.name) } as CSSProperties;
  const connected = stats?.connectionState === "connected";
  const stalled = useStalled(!connected);
  return (
    <div style={style}>
      <div className="details-head">
        <span className="color-dot" />
        <strong>{participant.name}</strong>
      </div>
      {!stats || !connected ? (
        <p className={stalled ? "card-note card-note--bad" : "muted small"}>
          {stalled
            ? "No connection — they may have dropped. Dead sessions are cleared automatically."
            : stats?.connectionState === "disconnected"
              ? "Connection interrupted…"
              : "Connecting…"}
        </p>
      ) : (
        <div className="rows">
          <StatRow label="Quality" value={<ConnectionBadge quality={stats.quality} />} />
          <StatRow label="Latency" value={formatRtt(stats.roundTripTimeMs)} />
          <StatRow label="Jitter" value={formatJitter(stats.jitterMs)} />
          <StatRow label="Packet loss (last 10s)" value={`${stats.lossPercent.toFixed(1)}%`} />
          <StatRow label="Packets lost (total)" value={String(stats.packetsLost)} />
          <StatRow label="Download" value={formatKbps(bytesToKbps(stats.bytesReceivedDelta, stats.intervalMs))} />
          <StatRow label="Upload" value={formatKbps(bytesToKbps(stats.bytesSentDelta, stats.intervalMs))} />
          <StatRow
            label="Path"
            value={stats.isRelayed ? `Relay${stats.relayProvider ? ` · ${stats.relayProvider}` : ""}` : "Direct P2P"}
          />
        </div>
      )}
    </div>
  );
}
