import type { ConnectionStats } from "../webrtc/ConnectionMonitor";
import { ConnectionBadge } from "./ConnectionBadge";
import { bytesToKbps, formatKbps, formatRtt } from "../utils/format";
import { worstQuality } from "../utils/quality";

/** Room-level summary across every active peer connection. */
export function NetworkPanel({ stats }: { stats: ConnectionStats[] }) {
  if (stats.length === 0) {
    return (
      <section className="panel">
        <h3>Network</h3>
        <p className="muted small">Waiting for other participants…</p>
      </section>
    );
  }

  const rtts = stats.map((s) => s.roundTripTimeMs).filter((v): v is number => v !== null);
  const avgRtt = rtts.length ? rtts.reduce((a, b) => a + b, 0) / rtts.length : null;
  const relayed = stats.filter((s) => s.isRelayed);
  const direct = stats.length - relayed.length;
  const provider = relayed.find((s) => s.relayProvider)?.relayProvider ?? null;
  const down = stats.reduce((sum, s) => sum + bytesToKbps(s.bytesReceivedDelta, s.intervalMs), 0);
  const up = stats.reduce((sum, s) => sum + bytesToKbps(s.bytesSentDelta, s.intervalMs), 0);
  const worst = worstQuality(stats.map((s) => s.quality));

  return (
    <section className="panel">
      <div className="panel-title-row">
        <h3>Network</h3>
        <ConnectionBadge quality={worst} />
      </div>
      <div className="blocks">
        <Block label="Peers" value={String(stats.length)} />
        <Block label="Avg latency" value={formatRtt(avgRtt)} accent={`q-${worst}`} />
        <Block label="Direct" value={String(direct)} accent="accent-direct" />
        <Block label="Relayed" value={String(relayed.length)} accent="accent-relay" />
        <Block label="Down" value={formatKbps(down)} />
        <Block label="Up" value={formatKbps(up)} />
      </div>
      {provider && <p className="muted small">Relay provider: {provider}</p>}
    </section>
  );
}

function Block({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className={`block ${accent ?? ""}`}>
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
