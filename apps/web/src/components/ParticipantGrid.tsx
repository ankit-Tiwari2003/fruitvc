import type { Participant } from "../../../../packages/shared/src/protocol";
import type { ConnectionStats } from "../webrtc/ConnectionMonitor";
import { ParticipantTile } from "./ParticipantTile";

export interface ParticipantGridProps {
  participants: Participant[];
  localParticipantId: string;
  remoteStreams: Map<string, MediaStream>;
  connectionStats: Map<string, ConnectionStats>;
  volume: number;
  localMicLive: boolean;
}

export function ParticipantGrid({
  participants,
  localParticipantId,
  remoteStreams,
  connectionStats,
  volume,
  localMicLive,
}: ParticipantGridProps) {
  return (
    <div className="grid">
      {participants.map((p) => (
        <ParticipantTile
          key={p.id}
          participant={p}
          isLocal={p.id === localParticipantId}
          remoteStream={remoteStreams.get(p.id)}
          stats={connectionStats.get(p.id)}
          volume={volume}
          micLive={localMicLive}
        />
      ))}
    </div>
  );
}
