import type { ConnectionStats } from "../webrtc/ConnectionMonitor";
import { ConnectionBadge } from "./ConnectionBadge";
import { StatRow } from "./StatRow";
import { bytesToKbps, formatKbps, formatRtt } from "../utils/format";
import { worstQuality } from "../utils/quality";

/** Room-level summary across every active peer connection (shown when no card is selected). */
export function NetworkPanel({ stats }: { stats: ConnectionStats[] }) {
  if (stats.length === 0) {
    return <p className="muted small">Waiting for other participants…</p>;
  }

  const rtts = stats.map((s) => s.roundTripTimeMs).filter((v): v is number => v !== null);
  const avgRtt = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : null;
  const relayed = stats.filter((s) => s.isRelayed);
  const direct = stats.length - relayed.length;
  const provider = relayed.find((s) => s.relayProvider)?.relayProvider ?? null;
  const down = stats.reduce((sum, s) => sum + bytesToKbps(s.bytesReceivedDelta, s.intervalMs), 0);
  const up = stats.reduce((sum, s) => sum + bytesToKbps(s.bytesSentDelta, s.intervalMs), 0);

  return (
    <div className="rows">
      <StatRow label="Overall" value={<ConnectionBadge quality={worstQuality(stats.map((s) => s.quality))} />} />
      <StatRow label="Peers" value={String(stats.length)} />
      <StatRow label="Avg latency" value={formatRtt(avgRtt)} />
      <StatRow label="Direct / Relayed" value={`${direct} / ${relayed.length}`} />
      <StatRow label="Download" value={formatKbps(down)} />
      <StatRow label="Upload" value={formatKbps(up)} />
      {provider && <StatRow label="Relay provider" value={provider} />}
    </div>
  );
}
