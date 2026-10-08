import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { joinRoom, type JoinRoomResponse } from "../api/roomsApi";
import { useLocalStream } from "../hooks/useLocalStream";
import { usePeerManager } from "../hooks/usePeerManager";
import { ParticipantGrid } from "../components/ParticipantGrid";
import { MicButton } from "../components/MicButton";
import { formatRoomCode, copyToClipboard } from "../utils/format";

export function RoomPage() {
  const { roomId } = useParams<{ roomId: string }>();
  const navigate = useNavigate();

  const [identity, setIdentity] = useState<JoinRoomResponse | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [copied, setCopied] = useState(false);

  const { stream, error: micError, isLoading: micLoading } = useLocalStream();

  // Join the room (HTTP) exactly once per roomId.
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

  function handleToggleMute() {
    if (!stream) return;
    const next = !isMuted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setIsMuted(next);
  }

  async function handleCopyCode() {
    if (!roomId) return;
    const ok = await copyToClipboard(roomId);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  if (micError) {
    return (
      <CenteredMessage>
        <p>🎙️ Couldn't access your microphone.</p>
        <p style={{ color: "#6b7280", fontSize: "0.9rem" }}>{micError}</p>
      </CenteredMessage>
    );
  }

  if (joinError) {
    return (
      <CenteredMessage>
        <p>{joinError}</p>
        <button onClick={() => navigate("/")}>Back home</button>
      </CenteredMessage>
    );
  }

  if (micLoading || !identity) {
    return <CenteredMessage>Connecting…</CenteredMessage>;
  }

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: "720px", margin: "2rem auto", padding: "0 1rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <div>
          <h2 style={{ margin: 0 }}>Room {formatRoomCode(roomId ?? "")}</h2>
          <button
            onClick={handleCopyCode}
            style={{ border: "none", background: "none", color: "#6b7280", cursor: "pointer", padding: 0, fontSize: "0.85rem" }}
          >
            {copied ? "Copied!" : "Copy code to invite friends"}
          </button>
        </div>
        <button onClick={() => navigate("/")} style={{ color: "#ef4444", border: "none", background: "none", cursor: "pointer" }}>
          Leave
        </button>
      </div>

      {peerError && (
        <p style={{ color: "#ef4444", fontSize: "0.85rem" }}>
          {peerError.message}
        </p>
      )}

      <ParticipantGrid
        participants={participants}
        localParticipantId={identity.participantId}
        remoteStreams={remoteStreams}
        connectionStats={connectionStats}
      />

      <div style={{ marginTop: "2rem", display: "flex", justifyContent: "center" }}>
        <MicButton isMuted={isMuted} onToggle={handleToggleMute} />
      </div>
    </div>
  );
}

function CenteredMessage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", marginTop: "4rem" }}>{children}</div>
  );
}
