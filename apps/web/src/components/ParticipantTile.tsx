import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Participant } from "../../../../packages/shared/src/protocol";
import type { ConnectionStats } from "../webrtc/ConnectionMonitor";
import { ConnectionBadge } from "./ConnectionBadge";
import { participantColor } from "../utils/identity";
import { bytesToKbps, formatJitter, formatKbps, formatRtt } from "../utils/format";
import { useStalled } from "../hooks/useStalled";

export interface ParticipantTileProps {
  participant: Participant;
  isLocal: boolean;
  remoteStream?: MediaStream;
  stats?: ConnectionStats;
  volume: number; // 0..1, applied to remote audio only
  micLive: boolean; // local card only: is our mic currently sending?
  inputLabel: string; // local card only: name of the mic device in use
  selected: boolean;
  onSelect: () => void;
}

/** One participant card: name, six headline metrics, and a Select button. */
export function ParticipantTile({
  participant,
  isLocal,
  remoteStream,
  stats,
  volume,
  micLive,
  inputLabel,
  selected,
  onSelect,
}: ParticipantTileProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  // Numbers only mean something while the connection is actually up. A member
  // whose connection never formed (or died) must not look like a healthy "Good" one.
  const connected = stats?.connectionState === "connected";
  const stalled = useStalled(!isLocal && !connected);

  useEffect(() => {
    if (audioRef.current && remoteStream) audioRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  const style = { "--tile-color": participantColor(participant.name) } as CSSProperties;
  const dash = "—";

  return (
    <div className={`card ${isLocal ? "card--local" : ""} ${selected ? "card--selected" : ""}`} style={style}>
      <div className="card-head">
        <span className="color-dot" />
        <strong className="card-name">{participant.name}</strong>
        {isLocal && <span className="you-tag">You</span>}
      </div>

      {isLocal ? (
        <div className="card-metrics">
          <Metric label="Microphone" value={micLive ? "Live" : "Off"} />
          <Metric label="Input" value={inputLabel} wide />
        </div>
      ) : (
        <>
          {!connected && (
            <p className={`card-note ${stalled ? "card-note--bad" : ""}`}>
              {stalled
                ? "No connection — they may have dropped. Dead sessions are cleared automatically."
                : stats?.connectionState === "disconnected"
                  ? "Connection interrupted…"
                  : "Connecting…"}
            </p>
          )}
          <div className="card-metrics">
            <Metric label="Latency" value={connected && stats ? formatRtt(stats.roundTripTimeMs) : dash} />
            <Metric label="Jitter" value={connected && stats ? formatJitter(stats.jitterMs) : dash} />
            <Metric label="Packet loss" value={connected && stats ? `${stats.lossPercent.toFixed(1)}%` : dash} />
            <Metric label="Path" value={connected && stats ? (stats.isRelayed ? "Relay" : "Direct") : dash} />
            <Metric label="Quality" value={connected && stats ? <ConnectionBadge quality={stats.quality} /> : dash} />
            <Metric
              label="Download"
              value={connected && stats ? formatKbps(bytesToKbps(stats.bytesReceivedDelta, stats.intervalMs)) : dash}
            />
          </div>
          <button className="select-btn" onClick={onSelect}>
            {selected ? "Selected" : "Select"}
          </button>
          {/* You don't play back your own mic, so only remote cards get an <audio> element. */}
          <audio ref={audioRef} autoPlay playsInline />
        </>
      )}
    </div>
  );
}

function Metric({ label, value, wide }: { label: string; value: ReactNode; wide?: boolean }) {
  return (
    <div className={`metric ${wide ? "metric--wide" : ""}`}>
      <span className="muted small">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
