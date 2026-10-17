import { useState } from "react";
import type { Participant } from "../../../../packages/shared/src/protocol";
import type { ConnectionStats } from "../webrtc/ConnectionMonitor";
import type { UseMicControlResult } from "../hooks/useMicControl";
import type { AudioInputDevice } from "../hooks/useAudioInputs";
import { ParticipantGrid } from "./ParticipantGrid";
import { ParticipantDetails } from "./ParticipantDetails";
import { NetworkPanel } from "./NetworkPanel";
import { SettingsPanel } from "./SettingsPanel";
import { ConnectivityPanel } from "./ConnectivityPanel";
import { isRelayTestMode, type RelayStatus } from "../webrtc/IceManager";
import { ControlBar } from "./ControlBar";
import { formatRoomCode } from "../utils/format";

export interface RoomViewProps {
  roomId: string;
  localParticipantId: string;
  participants: Participant[];
  remoteStreams: Map<string, MediaStream>;
  connectionStats: Map<string, ConnectionStats>;
  peerError: string | null;
  relay: { status: RelayStatus; detail?: string };
  copied: boolean;
  onCopyInvite: () => void;
  onLeave: () => void;
  mic: UseMicControlResult;
  micInput: {
    devices: AudioInputDevice[];
    activeDeviceId: string | null;
    track: MediaStreamTrack | null;
    error: string | null;
    onSelect: (deviceId: string) => void;
  };
  volume: number;
  onVolumeChange: (volume: number) => void;
}

/**
 * Full-screen desktop layout: card grid (left), details + settings (right),
 * call controls (bottom). Purely presentational — all state comes in as props
 * except which card is selected, which is UI-only.
 */
export function RoomView(props: RoomViewProps) {
  const { participants, localParticipantId, connectionStats } = props;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { devices, activeDeviceId } = props.micInput;
  const localInputLabel = devices.find((d) => d.deviceId === activeDeviceId)?.label ?? "Default microphone";

  const relayTestMode = isRelayTestMode();
  const peers = participants.filter((p) => p.id !== localParticipantId);
  const selected = peers.find((p) => p.id === selectedId) ?? null; // falls back to summary if they left
  // Stats entries outlive a peer that left (the hook never prunes them), so
  // only summarise peers who are actually still in the room.
  const peerStats = peers.map((p) => connectionStats.get(p.id)).filter((s): s is ConnectionStats => s !== undefined && s.connectionState === "connected");

  return (
    <div className="room">
      <header className="room-header">
        <div className="room-title">
          <span className="brand">🍉 FruitVC</span>
          <span className="muted">Room {formatRoomCode(props.roomId)}</span>
          {relayTestMode && <span className="chip chip--relay">Relay-only test</span>}
        </div>
        <button className="btn btn-secondary btn-small" onClick={props.onCopyInvite}>
          {props.copied ? "Link copied!" : "Copy invite link"}
        </button>
      </header>

      <main className="room-main">
        {props.peerError && <p className="error">{props.peerError}</p>}
        <ParticipantGrid
          participants={participants}
          localParticipantId={localParticipantId}
          remoteStreams={props.remoteStreams}
          connectionStats={connectionStats}
          volume={props.volume}
          localMicLive={props.mic.isTransmitting}
          localInputLabel={localInputLabel}
          localMicTrack={props.micInput.track}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
        />
      </main>

      <aside className="room-side">
        <section className="panel">
          <h3>{selected ? "Participant" : "Room network"}</h3>
          {selected ? (
            <ParticipantDetails participant={selected} stats={connectionStats.get(selected.id)} />
          ) : (
            <NetworkPanel stats={peerStats} />
          )}
        </section>
        <ConnectivityPanel relay={props.relay} relayTestMode={relayTestMode} />
        <SettingsPanel
          devices={props.micInput.devices}
          activeDeviceId={props.micInput.activeDeviceId}
          micTrack={props.micInput.track}
          micError={props.micInput.error}
          onSelectMic={props.micInput.onSelect}
          pushToTalk={props.mic.pushToTalk}
          onPushToTalkChange={props.mic.setPushToTalk}
          volume={props.volume}
          onVolumeChange={props.onVolumeChange}
        />
      </aside>

      <ControlBar mic={props.mic} onLeave={props.onLeave} />
    </div>
  );
}
