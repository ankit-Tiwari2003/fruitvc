import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Participant } from "../../../../packages/shared/src/protocol";
import type { ConnectionStats } from "../webrtc/ConnectionMonitor";
import { ConnectionBadge } from "./ConnectionBadge";
import { participantColor } from "../utils/identity";
import { bytesToKbps, formatJitter, formatKbps, formatRtt } from "../utils/format";

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
          <div className="card-metrics">
            <Metric label="Latency" value={stats ? formatRtt(stats.roundTripTimeMs) : dash} />
            <Metric label="Jitter" value={stats ? formatJitter(stats.jitterMs) : dash} />
            <Metric label="Packets lost" value={stats ? String(stats.packetsLost) : dash} />
            <Metric label="Path" value={stats ? (stats.isRelayed ? "Relay" : "Direct") : dash} />
            <Metric label="Quality" value={stats ? <ConnectionBadge quality={stats.quality} /> : dash} />
            <Metric
              label="Download"
              value={stats ? formatKbps(bytesToKbps(stats.bytesReceivedDelta, stats.intervalMs)) : dash}
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
