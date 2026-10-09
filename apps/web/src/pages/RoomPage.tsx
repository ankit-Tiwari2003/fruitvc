import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { joinRoom, type JoinRoomResponse } from "../api/roomsApi";
import { useLocalStream } from "../hooks/useLocalStream";
import { useMicControl } from "../hooks/useMicControl";
import { usePeerManager } from "../hooks/usePeerManager";
import { ParticipantGrid } from "../components/ParticipantGrid";
import { MicButton } from "../components/MicButton";
import { NetworkPanel } from "../components/NetworkPanel";
import { SettingsPanel } from "../components/SettingsPanel";
import { formatRoomCode, copyToClipboard } from "../utils/format";
import type { ConnectionStats } from "../webrtc/ConnectionMonitor";

export function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  const [identity, setIdentity] = useState<JoinRoomResponse | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [volume, setVolume] = useState(1);

  const { stream, error: micError, isLoading: micLoading } = useLocalStream();
  const mic = useMicControl(stream);

  // Join (HTTP) only once the mic is granted, so the 60s join-token clock
  // doesn't run out while the permission prompt is still showing.
  useEffect(() => {
    if (!roomId || !stream) return;
    let cancelled = false;
    joinRoom(roomId)
      .then((res) => {
        if (!cancelled) setIdentity(res);
      })
      .catch(() => {
        if (!cancelled) setJoinError("Could not join this room. It may not exist or may be full.");
      });
    return () => {
      cancelled = true;
    };
  }, [roomId, stream]);

  const { participants, remoteStreams, connectionStats, error: peerError } = usePeerManager({
    roomId: roomId ?? "",
    participantId: identity?.participantId ?? "",
    token: identity?.token ?? "",
    localStream: stream,
  });

  async function handleCopyInvite() {
    if (!roomId) return;
    const ok = await copyToClipboard(`${window.location.origin}/room/${roomId}`);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  if (micError) {
    return (
      <Centered>
        <p>🎙️ Couldn't access your microphone.</p>
        <p className="muted small">{micError}</p>
        <button className="btn btn-secondary" onClick={() => navigate("/")}>Back home</button>
      </Centered>
    );
  }

  if (joinError) {
    return (
      <Centered>
        <p>{joinError}</p>
        <button className="btn btn-secondary" onClick={() => navigate("/")}>Back home</button>
      </Centered>
    );
  }

  if (micLoading || !identity) {
    return <Centered>Connecting…</Centered>;
  }

  // Stats entries outlive a peer that left (the hook never prunes them), so
  // only summarise peers who are actually still in the room.
  const peerStats = participants
    .filter((p) => p.id !== identity.participantId)
    .map((p) => connectionStats.get(p.id))
    .filter((s): s is ConnectionStats => s !== undefined);

  return (
    <div className="room">
      <header className="room-header">
        <div>
          <h2>Room {formatRoomCode(roomId ?? "")}</h2>
          <button className="link-btn" onClick={handleCopyInvite}>
            {copied ? "Link copied!" : "Copy invite link"}
          </button>
        </div>
        <button className="leave-btn" onClick={() => navigate("/")}>Leave</button>
      </header>

      {peerError && <p className="error">{peerError.message}</p>}

      <div className="room-body">
        <section className="room-main">
          <ParticipantGrid
            participants={participants}
            localParticipantId={identity.participantId}
            remoteStreams={remoteStreams}
            connectionStats={connectionStats}
            volume={volume}
            localMicLive={mic.isTransmitting}
          />
          <div className="controls">
            <MicButton
              isMuted={mic.isMuted}
              onToggle={mic.toggleMute}
              pushToTalk={mic.pushToTalk}
              isHolding={mic.isHolding}
              onHoldChange={mic.setIsHolding}
            />
          </div>
        </section>

        <aside className="room-side">
          <NetworkPanel stats={peerStats} />
          <SettingsPanel
            pushToTalk={mic.pushToTalk}
            onPushToTalkChange={mic.setPushToTalk}
            volume={volume}
            onVolumeChange={setVolume}
          />
        </aside>
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="centered">{children}</div>;
}
