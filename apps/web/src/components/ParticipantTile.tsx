import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";
import type { Participant } from "../../../../packages/shared/src/protocol";
import type { ConnectionStats } from "../webrtc/ConnectionMonitor";
import { ConnectionBadge } from "./ConnectionBadge";
import { participantColor, participantInitial } from "../utils/identity";
import { bytesToKbps, formatJitter, formatKbps, formatRtt } from "../utils/format";

export interface ParticipantTileProps {
  participant: Participant;
  isLocal: boolean;
  remoteStream?: MediaStream;
  stats?: ConnectionStats;
  volume: number; // 0..1, applied to remote audio only
  micLive: boolean; // local tile only: is our mic currently sending?
}

export function ParticipantTile({ participant, isLocal, remoteStream, stats, volume, micLive }: ParticipantTileProps) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current && remoteStream) {
      audioRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const style = { "--tile-color": participantColor(participant.name) } as CSSProperties;

  return (
    <div className="tile" style={style}>
      <div className="tile-head">
        <div className="avatar">{participantInitial(participant.name)}</div>
        <div className="tile-name">
          <strong>{participant.name}</strong>
          {isLocal && <span className="muted"> (you)</span>}
          {isLocal && <div className="muted small">{micLive ? "🎙️ Mic live" : "🔇 Mic off"}</div>}
        </div>
      </div>

      {!isLocal && !stats && <p className="muted small">Connecting…</p>}

      {!isLocal && stats && (
        <>
          <div className="tile-chips">
            <ConnectionBadge quality={stats.quality} />
            <span className={`chip ${stats.isRelayed ? "chip--relay" : "chip--direct"}`}>
              {stats.isRelayed ? `Relay${stats.relayProvider ? ` · ${stats.relayProvider}` : ""}` : "Direct P2P"}
            </span>
          </div>
          <div className="metrics">
            <Metric label="Latency" value={formatRtt(stats.roundTripTimeMs)} />
            <Metric label="Jitter" value={formatJitter(stats.jitterMs)} />
            <Metric label="Lost" value={`${stats.packetsLost} pkts`} />
            <Metric label="Down" value={formatKbps(bytesToKbps(stats.bytesReceivedDelta, stats.intervalMs))} />
            <Metric label="Up" value={formatKbps(bytesToKbps(stats.bytesSentDelta, stats.intervalMs))} />
          </div>
        </>
      )}

      {/* Local participant never gets an <audio> element — you don't play back your own mic. */}
      {!isLocal && <audio ref={audioRef} autoPlay playsInline />}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
