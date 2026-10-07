import { useEffect, useRef } from "react";
import type { Participant } from "../../../../packages/shared/src/protocol";
import type { ConnectionStats } from "../webrtc/ConnectionMonitor";
import { ConnectionBadge } from "./ConnectionBadge";

export interface ParticipantTileProps {
  participant: Participant;
  isLocal: boolean;
  remoteStream?: MediaStream;
  stats?: ConnectionStats;
}

export function ParticipantTile({ participant, isLocal, remoteStream, stats }: ParticipantTileProps) {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current && remoteStream) {
      audioRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  return (
    <div
      style={{
        border: "1px solid #e5e7eb",
        borderRadius: "0.75rem",
        padding: "1rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        minWidth: "160px",
      }}
    >
      <strong>
        {participant.name}
        {isLocal && " (you)"}
      </strong>
      {!isLocal && stats && <ConnectionBadge quality={stats.quality} />}
      {/* Local participant never gets an <audio> element — you don't play back your own mic. */}
      {!isLocal && <audio ref={audioRef} autoPlay playsInline />}
    </div>
  );
}
