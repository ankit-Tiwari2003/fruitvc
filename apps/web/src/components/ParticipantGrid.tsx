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
  localInputLabel: string;
  localMicTrack: MediaStreamTrack | null;
  selectedId: string | null;
  onSelect: (participantId: string | null) => void;
}

export function ParticipantGrid({
  participants,
  localParticipantId,
  remoteStreams,
  connectionStats,
  volume,
  localMicLive,
  localInputLabel,
  localMicTrack,
  selectedId,
  onSelect,
}: ParticipantGridProps) {
  // Keep your own card first so the layout doesn't shuffle as people join.
  const ordered = [...participants].sort(
    (a, b) => Number(b.id === localParticipantId) - Number(a.id === localParticipantId)
  );
  const hasPeers = participants.some((p) => p.id !== localParticipantId);

  return (
    <div className="grid">
      {ordered.map((p) => (
        <ParticipantTile
          key={p.id}
          participant={p}
          isLocal={p.id === localParticipantId}
          remoteStream={remoteStreams.get(p.id)}
          stats={connectionStats.get(p.id)}
          volume={volume}
          micLive={localMicLive}
          inputLabel={localInputLabel}
          micTrack={localMicTrack}
          selected={p.id === selectedId}
          onSelect={() => onSelect(p.id === selectedId ? null : p.id)}
        />
      ))}
      {!hasPeers && (
        <div className="card card--empty">
          <strong>Waiting for friends…</strong>
          <p className="muted small">Share the invite link or the room code.</p>
        </div>
      )}
    </div>
  );
}
